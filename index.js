const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

app.use('/', express.static(path.join(__dirname, 'public')))
http.listen(80, function() {
    console.log('Starting server on port 80')
})

const maxpages = process.env.MAX_SESSIONS || 10
const adminsecret = process.env.DUNGEONMASTER_TOKEN || 'test'
const maxmapsize = 1024*1024* (parseInt(process.env.MAX_MAPSIZE_MB) || 10)
const maxdiskuse = 1024*1024* (parseInt(process.env.MAX_DISKUSE_MB) || 1024)
const maxmarkers = process.env.MAX_MARKERS || 1000
const maxareas =   process.env.MAX_AREAS   || 500
const maxeffects = process.env.MAX_EFFECTS || 50
const maxinitiative = process.env.MAX_INITIATIVE || 100

let pages = {}
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

console.log('Starting','node version:',process.version,'dep versions:',process.versions)

check_disk()

// We want this read before we start, so do it synchronously
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
    console.log('Connection from '+(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address)+' id='+socket.id)

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
                if (pages[pageid].frozen) {
                    socket.emit('message', 'Page is frozen')
                    return
                }
                do_deletepage(socket, pageid)
            })
            socket.on('zoom', (zoom, pageid) => {
                if (!pages[pageid]) { return }
                if (pages[pageid].frozen) { return }
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
                do_mapupload(socket, upmap, pageid)
            })
            socket.on('mapuploaddata', (upmap, pageid) => {
                do_mapuploaddata(socket, upmap, pageid)
            })
            socket.on('mapremove', (mapname, pageid) => {
                do_mapremove(socket, mapname, pageid)
            })
            socket.on('map', (map, pageid) => {
                do_map(socket, map, pageid)
            })
            socket.on('initiative', (initiative, pageid) => {
                if (!pages[pageid]) { return }
                if (pages[pageid].frozen) {
                    socket.emit('initiative', pages[pageid].initiative, pageid)
                    socket.emit('message', 'Page is frozen')
                    return
                }

                if (initiative.order) {
                    if (initiative.order.length > maxinitiative) {
                        socket.emit('message', 'Initiative list too large: '+initiative.order.length+' > '+maxinitiative)
                        return
                    }
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
                do_selectpage(socket, pageid)
            })
            socket.on('clearzoom', (pageid) => {
                if (!pages[pageid]) { return }
                if (pages[pageid].frozen) { return }
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
                if (pages[pageid].frozen) { return }
                pages[pageid].title = pagetitle
                io.emit('pagetitle', pagetitle, pageid)
            })
            socket.on('freeze', (frozen, pageid) => {
                if (!pages[pageid]) { return }
                pages[pageid].frozen = frozen
                io.emit('freeze', frozen, pageid)
            })
            socket.emit('pages', pages)
            socket.emit('diskusage', diskusage)
            save_pages(true)
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
            do_selectpage(socket, pageid)
        }
        socket.on('marker', (marker, pageid) => {
            if (!pages[pageid]) { return }
            if (pages[pageid].frozen) { return }
            if (!pages[pageid].markers[marker.id]) {
                if (!admin) {
                    // Allow grabbing player markers
                    if (!marker.cls.match(/(^| )pc( |$)/)) {
                        // Kill the marker clientside
                        socket.emit('marker', { id: marker.id, remove: true }, pageid)
                        return
                    }
                }
                if (marker.charid) {
                    let mcount = 0
                    // Count doubles, remove pc doubles
                    for (key in pages[pageid].markers) {
                        const mrk = pages[pageid].markers[key]
                        if (mrk.charid == marker.charid) {
                            if (mrk.cls.match(/(^| )pc( |$)/)) {
                                io.emit('marker', { id: mrk.id, remove: true}, pageid)
                                delete pages[pageid].markers[key]
                            } else {
                                mcount += 1
                                if (mcount == 1) {
                                    if (mrk.text != '1') {
                                        pages[pageid].markers[key].text = '1'
                                        io.emit('marker', pages[pageid].markers[key], pageid)
                                    }
                                }
                            }
                        }
                    }
                    if (mcount >= 1) {
                        if (marker.text.length == 1) {
                            marker.text = ''+(mcount+1)
                        }
                    }
                }
                // Check list size
                let keys = Object.keys(pages[pageid].markers)
                if (keys.length >= maxmarkers) {
                    keys.sort()
                    console.log('Too many markers on '+pageid+', deleting '+keys[0])
                    delete pages[pageid].markers[keys[0]]
                }
                pages[pageid].markers[marker.id] = {
                    id:     marker.id,
                    charid: marker.charid,
                    text:   marker.text,
                    cls:    marker.cls,
                    player: marker.player
                }
            } else if (!admin && !pages[pageid].markers[marker.id].player) {
                // Send original position back
                socket.emit('marker', pages[pageid].markers[marker.id], pageid)
                return
            }
            if (marker.imx != undefined) {
                pages[pageid].markers[marker.id].imx = marker.imx
            }
            if (marker.imy != undefined) {
                pages[pageid].markers[marker.id].imy = marker.imy
            }
            if (marker.text != undefined) {
                pages[pageid].markers[marker.id].text = marker.text
            }
            if (admin && marker.cls != undefined) {
                pages[pageid].markers[marker.id].cls = marker.cls
            }
            io.emit('marker', pages[pageid].markers[marker.id], pageid)
            save_pages()
        })
        socket.on('area', (area, pageid) => {
            if (!pages[pageid]) { return }
            if (pages[pageid].frozen) { return }
            if (!pages[pageid].areas[area.id]) {
                // Check list size
                let keys = Object.keys(pages[pageid].areas)
                if (keys.length >= maxareas) {
                    keys.sort()
                    console.log('Too many areas on '+pageid+', deleting '+keys[0])
                    delete pages[pageid].areas[keys[0]]
                }
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
            if (pages[pageid].frozen) { return }
            if (!pages[pageid].effects[effect.id]) {
                // Check list size
                let keys = Object.keys(pages[pageid].effects)
                if (keys.length >= maxeffects) {
                    keys.sort()
                    console.log('Too many effects on '+pageid+', deleting '+keys[0])
                    delete pages[pageid].effects[keys[0]]
                }
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
            if (pages[pageid].frozen) { return }
            let effecttd = pages[pageid].effects[effect.id]
            if (effecttd) {
                delete pages[pageid].effects[effect.id]
                io.emit('removeeffect', effecttd, pageid)
                for (const i in pages[pageid].areas) {
                    let area = pages[pageid].areas[i]
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

async function do_deletepage(socket, pageid)
{
    console.log('Removing page '+pageid+' ('+pages[pageid].title+')')
    console.log('Removing folder ./public/maps/'+pageid)
    try {
        await rmdir_recursive('./public/maps/'+pageid)
        await fsp.unlink('./pages/'+pageid+'.json')
        delete pages[pageid]
        socket.emit('page', null, null)
        socket.emit('pages', pages)
    } catch (ex) {
        console.log('Failed to remove ./public/maps/'+pageid+': ', ex)
        socket.emit('message', 'Failed to remove page '+pageid+': '+ ex)
    }
}

function checkmap(map)
{
    if (map.name.length > 50 || map.name.match(/[^A-Za-z0-9._ -]/)) {
        console.log('mapupload', 'illegal filename', map.name)
        socket.emit('message', 'illegal filename: '+map.name)
        return false
    }
    if (!map.fileext.match(/^(gif|jpg|jpeg|png)$/)) {
        console.log('mapupload', 'illegal file extension', map.fileext)
        socket.emit('message', 'illegal file extension: '+map.fileext)
        return false
    }
    if (!map.id.match(/^[a-z0-9]*$/)) {
        console.log('mapupload', 'illegal file id', map.id)
        socket.emit('message', 'illegal file id: '+map.id)
        return false
    }
    return true
}

async function do_mapupload(socket, upmap, pageid)
{
    if (!pages[pageid]) { return }
    if (pages[pageid].frozen) {
        socket.emit('message', 'Page is frozen')
        return
    }
    if (!checkmap(upmap)) { return }
    if (upmap.filesize > maxmapsize) {
        console.log('mapupload', 'file too large', upmap.data.length)
        socket.emit('message', 'file too large: '+formatBytes(upmap.data.length)+' > '+formatBytes(maxmapsize))
        return
    }
    const mapfolder = './public/maps/'+pageid
    try {
        await fsp.mkdir(mapfolder, { recursive: true })
        for (const file of await fsp.readdir(mapfolder)) {
            const m = file.match(/^(.*?)-[0-9a-z]*\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == upmap.name) {
                console.log('Removing for upload', mapfolder+'/'+file)
                await fsp.unlink(mapfolder+'/'+file)
            }
        }
        socket.emit('mapuploaddata', {
                id: upmap.id,
                name: upmap.name,
                fileext: upmap.fileext,
                path: pageid+'/'+upmap.name+'-'+upmap.id+'.'+upmap.fileext,
                pos: 0
            }, pageid)
    } catch (ex) {
        console.log('mapupload', 'Mapupload error: ', ex)
        socket.emit('message', 'Mapupload error: '+ex)
        return
    }
}

async function do_mapuploaddata(socket, upmap, pageid)
{
    if (!pages[pageid]) { return }
    if (pages[pageid].frozen) { return }
    if (!checkmap(upmap)) { return }
    if ((diskusagebytes + upmap.data.length) > maxdiskuse) {
        console.log('mapupload', 'disk too full', diskusage, upmap.data.length)
        socket.emit('message', 'disk too full: '+diskusage+' + '+formatBytes(upmap.data.length) + ' > '+formatBytes(maxdiskuse))
        return
    }
    try {
        const mappath = './public/maps/'+pageid+'/'+upmap.name+'-'+upmap.id+'.'+upmap.fileext
        let cursize = 0
        try {
            const fstat = await fsp.stat(mappath)
            cursize = fstat.size
        } catch (ex) {
            if (ex.code != 'ENOENT') { throw(ex) }
        }
        if (cursize != upmap.pos) {
            console.log('mapupload size mismatch error: '+cursize+' <> '+upmap.pos)
            socket.emit('message', 'mapupload size mismatch error: '+cursize+' <> '+upmap.pos)
            return
        }
        console.log('Writing map file', mappath, upmap.data.length, 'at', upmap.pos)
        await fsp.appendFile(mappath, upmap.data, 'Binary')
        diskusagebytes = diskusagebytes + upmap.data.length
        if (!upmap.finished) {
            socket.emit('mapuploaddata', {
                    id: upmap.id,
                    name: upmap.name,
                    fileext: upmap.fileext,
                    path: pageid+'/'+upmap.name+'-'+upmap.id+'.'+upmap.fileext,
                    pos: upmap.pos + upmap.data.length
                }, pageid)
            check_disk()
        } else {
            let map = {
                id: upmap.id,
                path: pageid+'/'+upmap.name+'-'+upmap.id+'.'+upmap.fileext,
                name: upmap.name
            }
            if (upmap.active) {
                pages[pageid].map = map
                io.emit('map', pages[pageid].map, pageid)
            }
            io.emit('mapfile', map, pageid)
            if (pages[pageid].zoom && pages[pageid].zoom.src) {
                zoomre = new RegExp('^maps/'+pageid+'/'+map.name+'\\-[0-9a-z]*\\.(jpeg|jpg|gif|png)$')
                if (pages[pageid].zoom.src.match(zoomre)) {
                    pages[pageid].zoom.src = 'maps/'+map.path
                    io.emit('zoom', pages[pageid].zoom, pageid)
                }
            }
            console.log('mapupload written', mappath)
            save_pages()
            check_disk(true)
        }
    } catch (ex) {
        console.log('mapupload', 'Mapupload error: ', ex)
        socket.emit('message', 'Mapupload error: '+ex)
        return
    }
}

async function do_mapremove(socket, mapname, pageid)
{
    if (!pages[pageid]) { return }
    if (pages[pageid].frozen) { return }
    try {
        let done = false
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z]*\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == mapname) {
                const mappath = './public/maps/'+pageid+'/'+file
                console.log('Removing mapfile '+mappath)
                await fsp.unlink(mappath)
                console.log('File removed: '+mappath)
                io.emit('mapremove', { name: mapname }, pageid)
                done = true
            }
        }
        check_disk(true)
        if (!done) {
            socket.emit('mapremove', {
                name: mapname,
                error: 'Not found'
            }, pageid)
        }
    } catch (ex) {
        console.log('error deleting map', ex)
        socket.emit('message', 'Error deleting map: '+ex)
    }
}

async function do_map(socket, map, pageid)
{
    if (!pages[pageid]) { return }
    if (pages[pageid].frozen) {
        io.emit('map', pages[pageid].map, pageid)
        return
    }
    try {
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z]*\.(jpeg|jpg|gif|png)$/i)
            if (m) {
                if (m[1] == map.name) {
                    pages[pageid].map = {
                        name: map.name,
                        path: pageid+'/'+file
                    }
                    io.emit('map', pages[pageid].map, pageid)
                    save_pages()
                    return
                }
            }
        }
        socket.emit('message', 'map '+map.name+' not found')
    } catch (ex) {
        socket.emit('message', 'error reading maps '+ex)
        return
    }
}

async function do_selectpage(socket, pageid)
{
    if (!pages[pageid]) { return }
    socket.emit('page', pages[pageid], pageid)
    try {
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z]*\.(jpeg|jpg|gif|png)$/i)
            if (m) {
                const mapname = m[1]
                const mappath = pageid+'/'+file
                socket.emit('mapfile', { name: mapname, path: mappath }, pageid)
            }
        }
        if (pages[pageid].map) {
            socket.emit('map', pages[pageid].map, pageid)
        }
    } catch (ex) {
        if (ex.code != 'ENOENT') {
            console.log('readmaps error', ex)
        }
    }
}

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

async function rmdir_recursive(path)
{
    try {
        for (const file of await fsp.readdir(path, { withFileTypes: true })) {
            const fpath = path+'/'+file.name
            console.log('Removing '+fpath)
            if (file.isDirectory()) {
                await rmdir_recursive(fpath)
                await fsp.rmdir(fpath)
            } else {
                await fsp.unlink(fpath)
            }
        }
    } catch (ex) {
        if (ex.code != 'ENOENT') {
            throw(ex)
        }
    }
}

// Check the size of a directory
async function check_disksize(path)
{
    let total = 0
    for (const file of await fsp.readdir(path, { withFileTypes: true })) {
        if (file.isDirectory()) {
            total += await check_disksize(path+'/'+file.name)
        } else {
            total += (await fsp.stat(path+'/'+file.name)).size
        }
    }
    return total
}

async function check_disk(force = false)
{
    const now = new Date().getTime()
    if (force || now > nextcheck) {
        nextcheck = now + 600000
        try {
            const totfilesize = await check_disksize('./public')
                diskusagebytes = totfilesize
                diskusage = formatBytes(totfilesize)
                console.log('Total size', totfilesize, diskusage)
                io.emit('diskusage', diskusage)
        } catch (ex) {
            console.log('Error scanning disk size: '+ex)
            nextcheck = now + 20000
            check_disk()
        }
    } else {
        if (checktimeout) { return }
        checktimeout = setTimeout(check_disk_timeout, 30000)
    }
}

async function save_pages(force = false)
{
    const now = new Date().getTime()
    if (force || (now > nextsave)) {
        nextsave = now + 10000
        try {
            for (const p in pages) {
                await fsp.writeFile('./pages/'+pages[p].id+'.json', JSON.stringify(pages[p], null, 2))
            }
        } catch (ex) {
            console.log('save_pages error', ex)
            save_pages()
        }
        check_disk()
    } else {
        if (savetimeout) { return }
        savetimeout = setTimeout(save_page_timeout, 15000)
    }
}
