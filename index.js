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

const maxpages = 5
let pages = {}
let currentplayerpage = ''
let adminsecret = process.env.DUNGEONMASTER_TOKEN
let pageid = 0

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
            admin = true
            console.log(socket.id+'  Admin connection')
            socket.on('createpage', (pageid) => {
                if (Object.keys(pages).length >= maxpages) {
                    console.log('Create page error: we already have '+maxpages+' pages')
                    socket.emit('message', 'Can\'t create page: Too many pages')
                    return
                }
                let token = Math.round(Math.pow(36,10)*Math.random()).toString(36)
                token = token.toString(36)
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
                socket.emit('pages', pages)
                socket.emit('page', pages[pageid], pageid)
                save_pages()
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
                for (const i in pages[pageid].markers) {
                    io.emit('marker', pages[pageid].markers[i], pageid)
                }
                for (const i in pages[pageid].effects) {
                    io.emit('effect', pages[pageid].effects[i], pageid)
                }
                for (const i in pages[pageid].areas) {
                    io.emit('area', pages[pageid].areas[i], pageid)
                }
                save_pages()
            })
            socket.on('mapupload', (upmap, pageid) => {
                if (!pages[pageid]) { return }
                if (upmap.data.length > 10000000) {
                    console.log('mapupload', 'file too large', upmap.data.length)
                    return
                }
                if (upmap.name.length > 50 || upmap.name.match(/[^A-Za-z0-9._-]/)) {
                    console.log('mapupload', 'illegal filename', upmap.name)
                    return
                }
                if (!upmap.fileext.match(/^(gif|jpg|jpeg|png)$/)) {
                    console.log('mapupload', 'illegal file extension', upmap.name)
                    return
                }
                let map = {
                    path: pageid+'/'+upmap.name+'.'+upmap.fileext,
                    name: upmap.name
                }
                const mappath = './public/maps/'+map.path
                console.log('mapupload', upmap.name, upmap.data.length)
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
                        const m = file.match(/^(.*)\.(jpeg|jpg|gif|png)$/i)
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
                        const m = file.match(/^(.*)\.(jpeg|jpg|png|gif)$/)
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
                        console.log('readmaps error', err)
                    } else {
                        for (const file of files) {
                            const m = file.match(/^(.*)\.(gif|jpg|jpeg|png)/i)
                            if (m) {
                                const mapname = m[1]
                                const mappath = pageid+'/'+file
                                socket.emit('mapfile', { name: mapname, path: mappath }, pageid)
                            }
                        }
                        if (pages[pageid].map) {
                            socket.emit('map', pages[pageid].map, pageid)
                        }
                    }
                })
            })
            socket.emit('pages', pages)
            if (currentplayerpage) {
                socket.emit('page', pages[currentplayerpage], currentplayerpage)
                if (pages[currentplayerpage].map) {
                      socket.emit('map', pages[currentplayerpage].map, currentplayerpage)
                }
            }
        } else {
            let found = null
            for (const p in pages) {
                // Allow for different pages with different tokens
                if (pages[p].token == secret) {
                    // Prefer an active page
                    if (!found || pages[p].active) {
                        found = p
                    }
                }
            }
            if (!found) {
                socket.disconnect()
                return
            }
            socket.emit('page', pages[found], found)
            if (pages[found].map) {
                  socket.emit('map', pages[found].map, currentplayerpage)
            }
        }
        socket.on('marker', (marker, pageid) => {
            console.log('marker', marker, pageid)
            if (!pages[pageid]) { return }
            if (!pages[pageid].markers[marker.id]) {
                if (!admin) { return }
                pages[pageid].markers[marker.id] = {
                    id:     marker.id,
                    text:   marker.text,
                    cls:    marker.cls,
                    player: marker.player
                }
            }
            if (!admin && !pages[pageid].markers[marker.id].player) { return }
            pages[pageid].markers[marker.id].imx = marker.imx
            pages[pageid].markers[marker.id].imy = marker.imy
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

let savetimeout = 0
let nextsave = 0

function save_page_timeout()
{
    savetimeout = 0
    save_pages()
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
    } else {
        if (savetimeout) { return }
        savetimeout = setTimeout(save_page_timeout, 15000)
    }
}
