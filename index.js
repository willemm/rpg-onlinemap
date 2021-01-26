var express = require('express')
var app = express()
var http = require('http').createServer(app)
var io = require('socket.io')(http)
var path = require('path')
app.use('/', express.static(path.join(__dirname, 'public')))
http.listen(8080, function() {
    console.log('Starting server on port 8080')
})

const maxpages = 5
let pages = {}
// Temporary hardcoded page (TODO)
pages['test'] = {
    id:      'test',
    token:   'test',
    title:   'test',
    active:  true,
    markers: {},
    areas:   {},
    effects: {}
}
let currentplayerpage = 'test'
let adminsecret = 'testadmin'
let pageid = 0

io.on('connection', function(socket) {
    console.log('Connection from '+socket.conn.remoteAddress+' id='+socket.id)

    let admin = false

    socket.on('join', (secret) => {
        console.log('join with token '+secret)
        if (secret == adminsecret) {
            admin = true
            console.log(socket.id+'  Admin connection')
            socket.on('createpage', (token) => {
                if (Object.keys(pages).length >= maxpages) {
                    console.log('Create page error: we already have '+maxpages+' pages')
                    socket.emit('error', 'Can\'t create page: Too many pages')
                    return
                }
                let pageid = new Date().getTime()
                if (pageid <= lastpageid) { pageid = lastpageid+1 }
                lastpageid = pageid
                pageid = pageid.toString(36)
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
            })
            socket.emit('pages', pages)
            socket.emit('page', pages[currentplayerpage])
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
        })
    })
    socket.on('disconnect', () => {
        if (admin) {
            console.log('Disconnect Admin socket '+socket.id)
        } else {
            console.log('Disconnect socket '+socket.id)
        }
    })
})
