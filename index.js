var express = require('express')
var app = express()
var http = require('http').createServer(app)
var io = require('socket.io')(http)
var path = require('path')
app.use('/', express.static(path.join(__dirname, 'public')))
http.listen(80, function() {
    console.log('Starting server on port 80')
})

const maxpages = 5
let pages = {}
let adminsecret = ''
let pageid = 0

io.on('connection', function(socket) {
    console.log('Connection from '+socket.conn.remoteAddress+' id='+socket.id)

    let admin = false

    socket.on('join', (secret) => {
        if (secret == adminsecret) {
            admin = true
            socket.on('createpage', (token) => {
                if (Object.keys(pages).length >= maxpages) {
                    console.log('Create page error: we already have '+maxpages+' pages')
                    socket.emit('error', 'Can\'t create page: Too many pages')
                    return
                }
                let pageid = new Date().getTime()
                if (pageid <= lastpageid) { pageid = lastpageid+1 }
                lastpageid = pageid
                pages[pageid] = {
                    id: pageid,
                    token: token,
                    title: '',
                    active: false,
                    pawns: {},
                    areas: {}
                }
                socket.emit('pages', pages)
                socket.emit('gotopage', pageid)
            })
            socket.on('movepawn', (pawn) => {
                if (!pages[pawn.page]) { return }
                if (pages[pawn.page].pawns[pawn.id]) {
                    pages[pawn.page].pawns[pawn.id].x = pawn.x
                    pages[pawn.page].pawns[pawn.id].y = pawn.y
                } else {
                    pages[pawn.page].pawns[pawn.id] = {
                        id:     pawn.id,
                        page:   pawn.page,
                        x:      pawn.x,
                        y:      pawn.y,
                        text:   pawn.text,
                        player: pawn.player
                    }
                }
                io.emit('movepawn', pages[pawn.page].pawns[pawn.id])
            })
            socket.emit('pages', pages)
        } else {
            for (const page of pages) {
                if (page.active && page.token == secret) {
                    socket.on('movepawn', (pawn) => {
                        if (!pages[pawn.page]) { return }
                        if (pages[pawn.page].pawns[pawn.id] && pages[pawn.page].pawns[pawn.id].player) {
                            pages[pawn.page].pawns[pawn.id].x = pawn.x
                            pages[pawn.page].pawns[pawn.id].y = pawn.y
                            io.emit('movepawn', pages[pawn.page].pawns[pawn.id])
                        }
                    })
                    socket.emit('page', page)
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
