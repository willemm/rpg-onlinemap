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
    areas:   {}
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
                    id: pageid,
                    token: token,
                    title: '',
                    active: false,
                    markers: {},
                    areas: {}
                }
                socket.emit('pages', pages)
                socket.emit('gotopage', pageid)
            })
            socket.on('movemarker', (marker) => {
                // console.log('admin movemarker', marker)
                if (!pages[marker.page]) { return }
                if (pages[marker.page].markers[marker.id]) {
                    pages[marker.page].markers[marker.id].imx = marker.imx
                    pages[marker.page].markers[marker.id].imy = marker.imy
                } else {
                    pages[marker.page].markers[marker.id] = {
                        id:     marker.id,
                        page:   marker.page,
                        imx:    marker.imx,
                        imy:    marker.imy,
                        text:   marker.text,
                        cls:    marker.cls,
                        player: marker.player
                    }
                }
                io.emit('movemarker', pages[marker.page].markers[marker.id])
            })
            socket.on('zoom', (zoom) => {
                if (!pages[zoom.page]) { return }
                pages[zoom.page].zoom = zoom
                io.emit('zoom', zoom)
            })
            socket.emit('pages', pages)
            socket.emit('gotopage', currentplayerpage)
        } else {
            for (const p in pages) {
                if (pages[p].active && pages[p].token == secret) {
                    socket.on('movemarker', (marker) => {
                        // console.log('player movemarker', marker)
                        if (!pages[marker.page]) { return }
                        if (pages[marker.page].markers[marker.id] && pages[marker.page].markers[marker.id].player) {
                            pages[marker.page].markers[marker.id].imx = marker.imx
                            pages[marker.page].markers[marker.id].imy = marker.imy
                            io.emit('movemarker', pages[marker.page].markers[marker.id])
                        }
                    })
                    socket.emit('page', pages[p])
                    return
                }
            }
            socket.disconnect()
        }
    })
    socket.on('disconnect', () => {
        console.log('Disconnect socket '+socket.id)
    })
})
