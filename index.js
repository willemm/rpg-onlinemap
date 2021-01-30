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

for (const dir of fs.readdirSync('./public/maps/', { withFileTypes: true })) {
    if (dir.isDirectory()) {
        try {
            let newpage = require('./pages/'+dir.name+'.json')
            newpage.id = dir.name
            newpage.maps = {}
            for (const file of fs.readdirSync('./public/maps/'+dir.name)) {
                const m = file.match(/^(.*)\.(gif|jpg|jpeg|png)/i)
                if (m) {
                    const mapname = m[1]
                    newpage.maps[mapname] = {
                        name: mapname,
                        path: dir.name+'/'+file,
                        active: false
                    }
                }
            }
            pages[dir.name] = newpage
            if (newpage.active) {
                currentplayerpage = dir.name
            }
        } catch (e) {
            console.log('Error reading pagefile from '+dir.name)
        }
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
                    socket.emit('error', 'Can\'t create page: Too many pages')
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
                    initiative: []
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
            socket.on('mapupload', (map, pageid) => {
                if (!pages[pageid]) { return }
                if (map.data.length > 10000000) {
                    console.log('mapupload', 'file too large', map.data.length)
                    return
                }
                if (map.name.length > 50 || map.name.match(/[^A-Za-z0-9._-]/)) {
                    console.log('mapupload', 'illegal filename', map.name)
                    return
                }
                if (!map.fileext.match(/^(gif|jpg|jpeg|png)$/)) {
                    console.log('mapupload', 'illegal file extension', map.name)
                    return
                }
                map.path = pageid+'/'+map.name+'.'+map.fileext
                const mappath = './public/maps/'+map.path
                console.log('mapupload', map.name, map.data.length)
                fs.writeFile(mappath, map.data, 'Binary', function(err) {
                    if (err) {
                        console.log('mapupload error', err)
                        return
                    }
                    pages[pageid].maps[map.name] = {
                        name: map.name,
                        path: map.path,
                        active: map.active
                    }
                    if (map.active) {
                        for (pagemap in pages[pageid].maps) {
                            pages[pageid].maps[pagemap].active = false
                        }
                        pages[pageid].maps[map.name].active = true
                        io.emit('map', pages[pageid].maps[map.name], pageid)
                    }
                    io.emit('mapfile', pages[pageid].maps[map.name], pageid)
                    console.log('mapupload written', mappath)
                    save_pages()
                })
            })
            socket.on('mapremove', (mapname, pageid) => {
                if (!pages[pageid] || !pages[pageid].maps[mapname]) {
                    socket.emit('mapremove', {
                        name: mapname,
                        error: 'Not found'
                    }, pageid)
                    return
                }
                const mappath = './public/maps/'+pages[pageid].maps[mapname].path
                console.log('Removing mapfile '+mappath)
                fs.unlink(mappath, function(err) {
                    if (err) {
                        console.log('mapremove error', err)
                        return
                    }
                    console.log('File removed: '+mappath)
                    let deletedmap = pages[pageid].maps[mapname]
                    delete pages[pageid].maps[mapname]
                    io.emit('mapremove', deletedmap, pageid)
                    save_pages()
                })
            })
            socket.on('map', (map, pageid) => {
                if (!pages[pageid] || !pages[pageid].maps[map.name]) {
                    return
                }
                for (pagemap in pages[pageid].maps) {
                    pages[pageid].maps[pagemap].active = false
                }
                pages[pageid].maps[map.name].active = true
                io.emit('map', pages[pageid].maps[map.name], pageid)
                save_pages()
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
            socket.emit('pages', pages)
            if (currentplayerpage) {
                socket.emit('page', pages[currentplayerpage], currentplayerpage)
                for (const key in pages[currentplayerpage].maps) {
                    const map = pages[currentplayerpage].maps[key]
                    if (map.active) {
                      socket.emit('map', map, currentplayerpage)
                    }
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
            for (const key in pages[found].maps) {
                const map = pages[found].maps[key]
                if (map.active) {
                  socket.emit('map', map, found)
                }
            }
        }
        socket.on('marker', (marker, pageid) => {
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
