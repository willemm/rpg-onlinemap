var express = require('express')
var app = express()
var http = require('http').createServer(app)
var io = require('socket.io')(http)
var path = require('path')
var fs = require('fs')
app.use('/', express.static(path.join(__dirname, 'public')))
http.listen(80, function() {
    console.log('Starting server on port 80')
})

const maxpages = 10
let pages = {}
let adminsecret = process.env.DUNGEONMASTER_TOKEN
let maxmapsize = 1024*1024* (parseInt(process.env.MAX_MAPSIZE_MB) || 10)
let maxdiskuse = 1024*1024* (parseInt(process.env.MAX_DISKUSE_MB) || 1024)
let pageid = 0
let diskusagebytes = 0
let diskusage = 'N/A'
let savetimeout = 0
let nextsave = 0
let checktimeout = 0
let nextcheck = 0
let lastuid = 0

function get_uid()
{
    newid = new Date().getTime()
    if (newid <= lastuid) { newid = lastuid+1 }
    lastuid = newid
    return newid.toString(36)
}

check_disk()

for (const pagefile of fs.readdirSync('./pages')) {
    try {
        const m = pagefile.match(/^(.*)\.json$/)
        if (m) {
            const pageid = m[1]
            let newpage = require('./pages/'+pagefile)
            newpage.id = pageid
            pages[pageid] = newpage
        }
    } catch (e) {
        console.log('Error reading pagefile from '+dir.name)
    }
}

io.on('connection', function(socket) {
    console.log('Connection from '+socket.conn.remoteAddress+' id='+socket.id)

    let admin = false

    socket.on('join', (secret) => {
        console.log('join with token '+secret)
        if (secret == adminsecret) {
            check_disk()
            admin = true
            console.log(socket.id+'  Admin connection')
            socket.on('createpage', (pageid) => {
                if (pages[pageid]) {
                    socket.emit('message', 'Page "'+pageid+'" already exists')
                    return
                }
                if (Object.keys(pages).length >= maxpages) {
                    console.log('Create page error: we already have '+maxpages+' pages')
                    socket.emit('message', 'Can\'t create page: Too many pages')
                    return
                }
                let token = Math.round(Math.pow(36,10)*Math.random()).toString(36)
                pages[pageid] = {
                    id:         pageid,
                    token:      token,
                    title:      '',
                    active:     false,
                    markers:    {},
                    areas:      {},
                    effects:    {},
                    initiative: [],
                    map:        null
                }
                socket.emit('page', pages[pageid], pageid)
                socket.emit('pages', pages)
                save_pages()
            })
            socket.on('deletepage', (pageid) => {
                if (!pages[pageid]) { return }
                console.log('Removing page '+pageid+' ('+pages[pageid].title+')')
                console.log('Removing folder ./public/maps/'+pageid)
                fs.rmdir('./public/maps/'+pageid, { recursive: true }, (err) => {
                    if (err) {
                        console.log('Failed to remove ./public/maps/'+pageid, err)
                        socket.emit('message', 'Failed to remove ./public/maps/'+pageid+': '+err)
                        return
                    }
                    console.log('Removing file ./pages/'+pageid+'.json')
                    fs.unlink('./pages/'+pageid+'.json', (err) => {
                        if (err) {
                            console.log('Failed to remove ./pages/'+pageid+'.json')
                            socket.emit('message', 'Failed to remove page-file: '+err)
                            return
                        }
                        delete pages[pageid]
                        socket.emit('page', {}, null)
                        socket.emit('pages', pages)
                    })
                })
            })
            socket.on('zoom', (zoom, pageid) => {
                if (!pages[pageid]) { return }
                pages[pageid].zoom = {
                  src: zoom.src,
                  imw: zoom.imw,
                  imh: zoom.imh,
                  x:   zoom.x,
                  y:   zoom.y,
                  w:   zoom.w,
                  h:   zoom.h
                }
                io.emit('zoom', pages[pageid].zoom, pageid)
                save_pages()
            })
            socket.on('mapupload', (upmap, pageid) => {
                if (!pages[pageid]) { return }
                if (upmap.name.length > 50 || upmap.name.match(/[^A-Za-z0-9._-]/)) {
                    console.log('mapupload', 'illegal filename', upmap.name)
                    socket.emit('message', 'illegal filename: '+upmap.name)
                    return
                }
                if (!upmap.fileext.match(/^(gif|jpg|jpeg|png)$/)) {
                    console.log('mapupload', 'illegal file extension', upmap.fileext)
                    socket.emit('message', 'illegal file extension: '+upmap.fileext)
                    return
                }
                if (upmap.data.length > maxmapsize) {
                    console.log('mapupload', 'file too large', upmap.data.length)
                    socket.emit('message', 'file too large: '+formatBytes(upmap.data.length)+' > '+formatBytes(maxmapsize))
                    return
                }
                if ((diskusagebytes + upmap.data.length) > maxdiskuse) {
                    console.log('mapupload', 'disk too full', diskusage, upmap.data.length)
                    socket.emit('message', 'disk too full: '+diskusage+' + '+formatBytes(upmap.data.length) + ' > '+formatBytes(maxdiskuse))
                    return
                }
                let map = {
                    path: pageid+'/'+upmap.name+'-'+get_uid()+'.'+upmap.fileext,
                    name: upmap.name
                }
                const mapfolder = './public/maps/'+pageid
                fs.mkdir(mapfolder, { recursive: true }, (err) => {
                    if (err) {
                        console.log('mapupload', 'Mapupload error: ', err)
                        socket.emit('message', 'failed to create folder '+err)
                        return
                    }
                    // Scan for files with the same name (maybe different extension)
                    fs.readdir(mapfolder, (err, files) => {
                        if (err) {
                            console.log('mapupload', 'Mapupload error: ', err)
                            socket.emit('message', 'failed to create folder '+err)
                            return
                        }
                        let unlinkpending = 0
                        function write_the_file(err) {
                            if (err) {
                                console.log('mapupload', 'Mapupload error: ', err)
                                socket.emit('message', 'failed to create folder '+err)
                                return
                            }
                            unlinkpending -= 1
                            if (unlinkpending > 0) {
                                console.log('Not writing yet, waiting for file deletion', unlinkpending)
                                return
                            }
                            const mappath = './public/maps/'+map.path
                            console.log('Writing map file', upmap.name, upmap.data.length)
                            fs.writeFile(mappath, upmap.data, 'Binary', function(err) {
                                if (err) {
                                    socket.emit('message', 'Mapupload error: '+err)
                                    console.log('mapupload error', err)
                                    return
                                }
                                if (upmap.active) {
                                    pages[pageid].map = map
                                    io.emit('map', pages[pageid].map, pageid)
                                }
                                io.emit('mapfile', map, pageid)
                                console.log('mapupload written', mappath)
                                save_pages()
                                check_disk(true)
                            })
                        }
                        for (const file of files) {
                            const m = file.match(/^(.*?)(-[0-9a-z]*)?\.(jpeg|jpg|gif|png)$/i)
                            if (m && m[1] == map.name) {
                                unlinkpending += 1
                                console.log('Removing for upload', mapfolder+'/'+file)
                                fs.unlink(mapfolder+'/'+file, write_the_file)
                            }
                        }
                        if (unlinkpending == 0) {
                            unlinkpending = 1
                            write_the_file()
                        }
                    })
                })
            })
            socket.on('mapremove', (mapname, pageid) => {
                if (!pages[pageid]) {
                    socket.emit('mapremove', {
                        name: mapname,
                        error: 'Not found'
                    }, pageid)
                    return
                }
                fs.readdir('./public/maps/'+pageid, (err, files) => {
                    if (err) {
                        console.log('error reading map dir', err)
                        socket.emit('message', 'Error reading maps: '+err)
                        return
                    }
                    let done = false
                    for (const file of files) {
                        const m = file.match(/^(.*?)(-[0-9a-z]*)?\.(jpeg|jpg|gif|png)$/i)
                        if (m && m[1] == mapname) {
                            const mappath = './public/maps/'+pageid+'/'+file
                            console.log('Removing mapfile '+mappath)
                            fs.unlink(mappath, function(err) {
                                if (err) {
                                    console.log('mapremove error', err)
                                    socket.emit('message', 'Error deleting map: '+err)
                                    return
                                }
                                console.log('File removed: '+mappath)
                                io.emit('mapremove', { name: mapname }, pageid)
                                done = true
                                check_disk(true)
                            })
                        }
                    }
                    save_pages()
                    if (!done) {
                        socket.emit('mapremove', {
                            name: mapname,
                            error: 'Not found'
                        }, pageid)
                    }
                })
            })
            socket.on('map', (map, pageid) => {
                if (!pages[pageid]) { return }
                fs.readdir('./public/maps/'+pageid, (err, files) => {
                    if (err) {
                        socket.emit('message', 'error reading maps '+err)
                        return
                    }
                    for (const file of files) {
                        const m = file.match(/^(.*?)(-[0-9a-z]*)?\.(jpeg|jpg|gif|png)$/i)
                        if (m) {
                            if (m[1] == map.name) {
                                pages[pageid].map = {
                                    name: map.name,
                                    path: pageid+'/'+file
                                }
                                io.emit('map', pages[pageid].map, pageid)
                                return
                            }
                        }
                    }
                    socket.emit('message', 'map '+map.name+' not found')
                    save_pages()
                })
            })
            socket.on('initiative', (initiative, pageid) => {
                if (!pages[pageid]) { return }

                if (initiative.order) {
                    let order = []
                    for (o of initiative.order) {
                        order.push({
                            type:       o.type,
                            text:       o.text,
                            id:         o.id,
                            initiative: o.initiative
                        })
                    }
                    pages[pageid].initiative = order
                    io.emit('initiative', order, pageid)
                }
            })
            socket.on('selectpage', (pageid) => {
                if (!pages[pageid]) {
                    return { error: 'Page '+pageid+' not found' }
                }
                socket.emit('page', pages[pageid], pageid)
                fs.readdir('./public/maps/'+pageid, null, (err, files) => {
                    if (err) {
                        if (err.code != 'ENOENT') {
                            console.log('readmaps error', err)
                        }
                        return
                    }
                    for (const file of files) {
                        const m = file.match(/^(.*?)(-[0-9a-z]*)?\.(jpeg|jpg|gif|png)$/i)
                        if (m) {
                            const mapname = m[1]
                            const mappath = pageid+'/'+file
                            socket.emit('mapfile', { name: mapname, path: mappath }, pageid)
                        }
                    }
                    if (pages[pageid].map) {
                        socket.emit('map', pages[pageid].map, pageid)
                    }
                })
            })
            socket.on('clearzoom', (pageid) => {
                if (!pages[pageid]) { return }
                pages[pageid].markers = {}
                pages[pageid].areas = {}
                pages[pageid].effects = {}
                pages[pageid].zoom = {
                    x: 0, y: 0, h: 0, w: 0
                }
                if (pages[pageid].initiative) {
                    pages[pageid].initiative = pages[pageid].initiative.filter(item => item.type.match(/^(pc|empty)$/))
                    pages[pageid].initiative.forEach(item => item.initiative = null)
                    io.emit('initiative', pages[pageid].initiative, pageid)
                }
                io.emit('zoom', pages[pageid].zoom, pageid)
            })
            socket.on('pagetitle', (pagetitle, pageid) => {
                if (!pages[pageid]) { return }
                pages[pageid].title = pagetitle
                io.emit('pagetitle', pagetitle, pageid)
            })
            socket.emit('pages', pages)
            socket.emit('diskusage', diskusage)
        } else {
            let pageid = null
            for (const p in pages) {
                // Allow for different pages with different tokens
                if (pages[p].token == secret) {
                    // Prefer an active page
                    if (!pageid || pages[p].active) {
                        pageid = p
                    }
                }
            }
            if (!pageid) {
                socket.disconnect()
                return
            }
            socket.emit('page', pages[pageid], pageid)
            fs.readdir('./public/maps/'+pageid, null, (err, files) => {
                if (err) {
                    if (err.code != 'ENOENT') {
                        console.log('readmaps error', err)
                    }
                    return
                }
                for (const file of files) {
                    const m = file.match(/^(.*?)(-[0-9a-z]*)?\.(jpeg|jpg|gif|png)$/i)
                    if (m) {
                        const mapname = m[1]
                        const mappath = pageid+'/'+file
                        socket.emit('mapfile', { name: mapname, path: mappath }, pageid)
                    }
                }
            })
            if (pages[pageid].map) {
                  socket.emit('map', pages[pageid].map, pageid)
            }
        }
        socket.on('marker', (marker, pageid) => {
            if (!pages[pageid]) { return }
            if (!pages[pageid].markers[marker.id]) {
                if (!admin) { return }
                pages[pageid].markers[marker.id] = {
                    id:     marker.id,
                    charid: marker.charid,
                    text:   marker.text,
                    cls:    marker.cls,
                    player: marker.player
                }
            }
            if (!admin && !pages[pageid].markers[marker.id].player) { return }
            if (marker.imx != undefined) {
                pages[pageid].markers[marker.id].imx = marker.imx
            }
            if (marker.imy != undefined) {
                pages[pageid].markers[marker.id].imy = marker.imy
            }
            if (marker.text != undefined) {
                pages[pageid].markers[marker.id].text = marker.text
            }
            io.emit('marker', pages[pageid].markers[marker.id], pageid)
            save_pages()
        })
        socket.on('area', (area, pageid) => {
            if (!pages[pageid]) { return }
            if (!pages[pageid].areas[area.id]) {
                pages[pageid].areas[area.id] = {
                    id:     area.id,
                    cls:    area.cls,
                    color:  area.color,
                    player: area.player
                }
            }
            if (!admin && !pages[pageid].areas[area.id].player) { return }
            pages[pageid].areas[area.id].imx = area.imx
            pages[pageid].areas[area.id].imy = area.imy
            pages[pageid].areas[area.id].imw = area.imw
            pages[pageid].areas[area.id].imh = area.imh
            io.emit('area', pages[pageid].areas[area.id], pageid)
            save_pages()
        })
        socket.on('effect', (effect, pageid) => {
            if (!pages[pageid]) { return }
            if (!pages[pageid].effects[effect.id]) {
                pages[pageid].effects[effect.id] = {
                    id:     effect.id,
                    color:  effect.color,
                    player: effect.player
                }
            }
            pages[pageid].effects[effect.id].text = effect.text
            io.emit('effect', pages[pageid].effects[effect.id], pageid)
            save_pages()
        })
        socket.on('removeeffect', (effect, pageid) => {
            if (!pages[pageid]) { return }
            let effecttd = pages[pageid].effects[effect.id]
            if (effecttd) {
                delete pages[pageid].effects[effect.id]
                io.emit('removeeffect', effecttd, pageid)
                for (const i in pages[pageid].areas) {
                    var area = pages[pageid].areas[i]
                    if (area.color == effecttd.color) {
                        io.emit('removearea', area, pageid)
                        delete pages[pageid].areas[i]
                    }
                }
            }
            save_pages()
        })
        socket.on('getmarkers', (pageid) => {
            for (const i in pages[pageid].markers) {
                socket.emit('marker', pages[pageid].markers[i], pageid)
            }
            for (const i in pages[pageid].effects) {
                socket.emit('effect', pages[pageid].effects[i], pageid)
            }
            for (const i in pages[pageid].areas) {
                socket.emit('area', pages[pageid].areas[i], pageid)
            }
        })
    })
    socket.on('disconnect', () => {
        if (admin) {
            console.log('Disconnect Admin socket '+socket.id)
        } else {
            console.log('Disconnect socket '+socket.id)
        }
        save_pages()
    })
})

function save_page_timeout()
{
    savetimeout = 0
    save_pages()
}

function check_disk_timeout()
{
    checktimeout = 0
    check_disk()
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function check_disk(force = false)
{
    const now = new Date().getTime()
    if (force || now > nextcheck) {
        nextcheck = now + 600000
        let totfilesize = 0
        let pending = 1
        const mu = process.memoryUsage()
        console.log('Timestamp: '+new Date().toUTCString())
        console.log('Memory: rss='+formatBytes(mu.rss)+' tot='+formatBytes(mu.heapTotal)+' used='+formatBytes(mu.heapUsed)+' ext='+formatBytes(mu.external))
        console.log('Checking disk usage')
        function scan_file(path) {
            // console.log('scan_file', path, pending)
            fs.stat(path, (err,stats) => {
                if (err) {
                    console.log('Error scanning file "'+path+'"', err)
                    nextcheck = now + 20000
                    return
                }
                totfilesize += stats.size
                pending -= 1
                // console.log('scan_file done', path, pending)
                if (pending == 0) {
                    diskusagebytes = totfilesize
                    diskusage = formatBytes(totfilesize)
                    console.log('Total size', totfilesize, diskusage)
                    io.emit('diskusage', diskusage)
                }
            })
        }
        function scan_dir(path) {
            // console.log('scan_dir', path, pending)
            fs.readdir(path, { withFileTypes: true }, (err, files) => {
                if (err) {
                    console.log('Error scanning dir "'+path+'"', err)
                    nextcheck = now + 20000
                    return
                } 
                pending -= 1
                // console.log('scan_dir processing', path, pending)
                for (const file of files) {
                    pending += 1
                    if (file.isDirectory()) {
                        scan_dir(path+'/'+file.name)
                    } else {
                        scan_file(path+'/'+file.name)
                    }
                }
                // console.log('scan_dir done', path, pending)
                if (pending == 0) {
                    diskusagebytes = totfilesize/1024
                    diskusage = formatBytes(totfilesize)
                    console.log('Total size', totfilesize, diskusage)
                    io.emit('diskusage', diskusage)
                }
            })
        }
        scan_dir('./public')
    } else {
        if (checktimeout) { return }
        checktimeout = setTimeout(check_disk_timeout, 30000)
    }
}

function save_pages()
{
    const now = new Date().getTime()
    if (now > nextsave) {
        nextsave = now + 10000
        for (const p in pages) {
            fs.writeFile('./pages/'+pages[p].id+'.json', JSON.stringify(pages[p], null, 2), function(err) {
                if (err) {
                    console.log('save_pages error', err)
                    save_pages()
                }
            })
        }
        check_disk()
    } else {
        if (savetimeout) { return }
        savetimeout = setTimeout(save_page_timeout, 15000)
    }
}
