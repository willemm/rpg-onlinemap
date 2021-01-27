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
let adminsecret = 'testadmin'
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
                        page: dir.name,
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
                    id:      pageid,
                    token:   token,
                    title:   '',
                    active:  false,
                    markers: {},
                    areas:   {},
                    effects: {}
                }
                socket.emit('pages', pages)
                socket.emit('page', pages[pageid])
                save_pages()
            })
            socket.on('zoom', (zoom) => {
                if (!pages[zoom.page]) { return }
                pages[zoom.page].zoom = zoom
                io.emit('zoom', zoom)
                for (const i in pages[zoom.page].markers) {
                    io.emit('marker', pages[zoom.page].markers[i])
                }
                for (const i in pages[zoom.page].effects) {
                    io.emit('effect', pages[zoom.page].effects[i])
                }
                for (const i in pages[zoom.page].areas) {
                    io.emit('area', pages[zoom.page].areas[i])
                }
                save_pages()
            })
            socket.on('mapupload', (map) => {
                if (!pages[map.page]) { return }
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
                map.path = map.page+'/'+map.name+'.'+map.fileext
                const mappath = './public/maps/'+map.path
                console.log('mapupload', map.name, map.data.length)
                fs.writeFile(mappath, map.data, 'Binary', function(err) {
                    if (err) {
                        console.log('mapupload error', err)
                        return
                    }
                    pages[map.page].maps[map.name] = {
                        page: map.page,
                        name: map.name,
                        path: map.path,
                        active: map.active
                    }
                    if (map.active) {
                        for (pagemap in pages[map.page].maps) {
                            pages[map.page].maps[pagemap].active = false
                        }
                        pages[map.page].maps[map.name].active = true
                        io.emit('map', pages[map.page].maps[map.name].path)
                    }
                    io.emit('mapfile', pages[map.page].maps[map.name])
                    console.log('mapupload written', mappath)
                    save_pages()
                })
            })
            socket.on('mapremove', (map) => {
                if (!pages[map.page] || !pages[map.page].maps[map.name]) {
                    socket.emit('mapremove', {
                        page: map.page,
                        name: map.name,
                        error: 'Not found'
                    })
                    return
                }
                const mappath = './public/maps/'+pages[map.page].maps[map.name].path
                console.log('Removing mapfile '+mappath)
                fs.unlink(mappath, function(err) {
                    if (err) {
                        console.log('mapremove error', err)
                        return
                    }
                    console.log('File removed: '+mappath)
                    let deletedmap = pages[map.page].maps[map.name]
                    delete pages[map.page].maps[map.name]
                    io.emit('mapremove', deletedmap)
                    save_pages()
                })
            })
            socket.on('map', (map) => {
                if (!pages[map.page] || !pages[map.page].maps[map.name]) {
                    return
                }
                for (pagemap in pages[map.page].maps) {
                    pages[map.page].maps[pagemap].active = false
                }
                pages[map.page].maps[map.name].active = true
                io.emit('map', pages[map.page].maps[map.name].path)
                save_pages()
            })
            socket.emit('pages', pages)
            socket.emit('page', pages[currentplayerpage])
            socket.emit('admin', true)
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
            socket.emit('page', pages[found])
        }
        socket.on('marker', (marker) => {
            if (!pages[marker.page]) { return }
            if (!pages[marker.page].markers[marker.id]) {
                if (!admin) { return }
                pages[marker.page].markers[marker.id] = {
                    id:     marker.id,
                    page:   marker.page,
                    text:   marker.text,
                    cls:    marker.cls,
                    player: marker.player
                }
            }
            if (!admin && !pages[marker.page].markers[marker.id].player) { return }
            pages[marker.page].markers[marker.id].imx = marker.imx
            pages[marker.page].markers[marker.id].imy = marker.imy
            io.emit('marker', pages[marker.page].markers[marker.id])
            save_pages()
        })
        socket.on('area', (area) => {
            if (!pages[area.page]) { return }
            if (!pages[area.page].areas[area.id]) {
                pages[area.page].areas[area.id] = {
                    id:     area.id,
                    page:   area.page,
                    cls:    area.cls,
                    color:  area.color,
                    player: area.player
                }
            }
            if (!admin && !pages[area.page].areas[area.id].player) { return }
            pages[area.page].areas[area.id].imx = area.imx
            pages[area.page].areas[area.id].imy = area.imy
            pages[area.page].areas[area.id].imw = area.imw
            pages[area.page].areas[area.id].imh = area.imh
            io.emit('area', pages[area.page].areas[area.id])
            save_pages()
        })
        socket.on('effect', (effect) => {
            if (!pages[effect.page]) { return }
            if (!pages[effect.page].effects[effect.id]) {
                pages[effect.page].effects[effect.id] = {
                    id:     effect.id,
                    page:   effect.page,
                    color:  effect.color,
                    player: effect.player
                }
            }
            pages[effect.page].effects[effect.id].text = effect.text
            io.emit('effect', pages[effect.page].effects[effect.id])
            save_pages()
        })
        socket.on('removeeffect', (effect) => {
            if (!pages[effect.page]) { return }
            let effecttd = pages[effect.page].effects[effect.id]
            if (effecttd) {
                delete pages[effect.page].effects[effect.id]
                io.emit('removeeffect', effecttd)
                for (const i in pages[effecttd.page].areas) {
                    var area = pages[effecttd.page].areas[i]
                    if (area.color == effecttd.color) {
                        io.emit('removearea', area)
                        delete pages[effecttd.page].areas[i]
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
