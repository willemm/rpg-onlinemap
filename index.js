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
const adminsecrets = (process.env.DUNGEONMASTER_TOKEN || 'test').split(/[, ]+/)
const maxmapsize  = 1024*1024* (parseInt(process.env.MAX_MAPSIZE_MB) || 16)
const maxiconsize = 1024*1024* (parseInt(process.env.MAX_ICONSIZE_MB) || 1)
const maxdiskuse  = 1024*1024* (parseInt(process.env.MAX_DISKUSE_MB) || 256)
const maxmarkers = process.env.MAX_MARKERS || 1000
const maxicons =   process.env.MAX_ICONS || 1000
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
            // Backwards compatibility
            if (!newpage.owner)      { newpage.owner = 'default' }
            if (!newpage.icons)      { newpage.icons = {} }
            if (!newpage.areas)      { newpage.areas = {} }
            if (!newpage.effects)    { newpage.effects = {} }
            if (!newpage.markers)    { newpage.markers = {} }
            if (!newpage.initiative) { newpage.initiative = {} }
            pages[pageid] = newpage
        }
    } catch (e) {
        console.log('Error reading pagefile from '+dir.name)
    }
}

io.on('connection', function(socket) {
    console.log('Connection from '+(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address)+' id='+socket.id)

    let admin = null

    socket.on('join', (secret) => {
        console.log('join with token '+secret)
        if (adminsecrets.includes(secret)) {
            check_disk()
            const m = secret.match(/^(.+?)-(.*)$/)
            if (m) {
                admin = m[1]
            } else {
                admin = 'default'
            }
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
                let token = Math.floor(Math.pow(36,10)*Math.random()).toString(36)
                pages[pageid] = {
                    id:         pageid,
                    owner:      admin,
                    token:      token,
                    title:      '',
                    active:     false,
                    markers:    {},
                    areas:      {},
                    effects:    {},
                    initiative: [],
                    icons:      {},
                    map:        null
                }
                socket.emit('page', pages[pageid], pageid)
                socket.emit('pages', Object.values(pages).filter(p => p.owner == admin))
                save_pages()
            })
            socket.on('deletepage', (pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) {
                    socket.emit('message', 'Page is frozen')
                    return
                }
                do_deletepage(socket, pageid, admin)
            })
            socket.on('zoom', (zoom, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
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
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) {
                    socket.emit('message', 'Page is frozen')
                    return
                }
                do_mapupload(socket, upmap, pageid)
            })
            socket.on('mapuploaddata', (upmap, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) { return }
                do_mapuploaddata(socket, upmap, pageid)
            })
            socket.on('mapremove', (map, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) { return }
                do_mapremove(socket, map, pageid)
            })
            socket.on('mapedit', (map, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) { return }
                do_mapedit(socket, map, pageid)
            })
            socket.on('iconupload', (upicon) => {
                do_iconupload(socket, upicon, admin)
            })
            socket.on('iconuploaddata', (upicon) => {
                do_iconuploaddata(socket, upicon, admin)
            })
            socket.on('iconremove', (icon) => {
                do_iconremove(socket, icon, admin)
            })
            socket.on('map', (map, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) {
                    io.emit('map', pages[pageid].map, pageid)
                    return
                }
                do_map(socket, map, pageid)
            })
            socket.on('initiative', (initiative, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) {
                    socket.emit('initiative', pages[pageid].initiative, pageid)
                    socket.emit('message', 'Page is frozen')
                    return
                }

                if (initiative.order) {
                    if (initiative.order.length > maxinitiative) {
                        socket.emit('message', 'Initiative list too large: '+
                            initiative.order.length+' > '+maxinitiative)
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
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                do_selectpage(socket, pageid)
            })
            socket.on('clearzoom', (pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) { return }
                // Filter mainmap icons
                let icons = pages[pageid].icons
                pages[pageid].icons = {}
                for (ic in icons) {
                    if (icons[ic].mainmap) {
                        pages[pageid].icons[ic] = icons[ic]
                    }
                }

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
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                if (pages[pageid].frozen) { return }
                pages[pageid].title = pagetitle
                io.emit('pagetitle', pagetitle, pageid)
            })
            socket.on('freeze', (frozen, pageid) => {
                if (!pages[pageid] || pages[pageid].owner != admin) { return }
                pages[pageid].frozen = frozen
                io.emit('freeze', frozen, pageid)
            })
            socket.emit('pages', Object.values(pages).filter(p => p.owner == admin))
            socket.emit('diskusage', diskusage)
            do_sendicons(socket, admin)
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
                if (pages[pageid].owner != admin) {
                    // Allow grabbing player markers
                    if (!marker.cls.match(/(^| )pc( |$)/)) {
                        // Kill the marker clientside
                        socket.emit('marker', { id: marker.id, remove: true }, pageid)
                        return
                    }
                }
                if (marker.charid) {
                    let mcount = 0
                    // Count doubles
                    for (key in pages[pageid].markers) {
                        const mrk = pages[pageid].markers[key]
                        if (mrk.charid == marker.charid) {
                            if (mrk.cls.match(/(^| )pc( |$)/)) {
                                // Remove pc doubles
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
            } else if ((pages[pageid].owner != admin) && !pages[pageid].markers[marker.id].player) {
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
            /* Disabled: Race condition with marker numbering, and not actually used anyway
            if (marker.text != undefined) {
                pages[pageid].markers[marker.id].text = marker.text
            }
            */
            if ((pages[pageid].owner == admin) && (marker.cls != undefined)) {
                pages[pageid].markers[marker.id].cls = marker.cls
            }
            io.emit('marker', pages[pageid].markers[marker.id], pageid)
            save_pages()
        })
        socket.on('icon', (icon, pageid) => {
            if (!pages[pageid]) { return }
            if (pages[pageid].frozen) { return }
            if (!pages[pageid].icons[icon.id]) {
                if (pages[pageid].owner != admin) {
                    return
                }
                // Check list size
                let keys = Object.keys(pages[pageid].icons)
                if (keys.length >= maxicons) {
                    keys.sort()
                    console.log('Too many icons on '+pageid+', deleting '+keys[0])
                    delete pages[pageid].icons[keys[0]]
                }
                pages[pageid].icons[icon.id] = {
                    id:      icon.id,
                    path:    icon.path,
                    name:    icon.name,
                    angle:   icon.angle,
                    locked:  icon.locked  || false,
                    mainmap: icon.mainmap || false
                }
            }
            if ((pages[pageid].owner == admin) && icon.locked != undefined) {
                pages[pageid].icons[icon.id].locked = icon.locked
            } else {
                if (pages[pageid].icons[icon.id].locked) {
                    // Send original position back
                    socket.emit('icon', pages[pageid].icons[icon.id], pageid)
                    return
                }
            }
            if ((pages[pageid].owner == admin) && (icon.remove)) {
                delete pages[pageid].icons[icon.id]
                io.emit('icon', { id: icon.id, remove: true }, pageid)
                save_pages()
                return
            }
            if (icon.imx != undefined) {
                pages[pageid].icons[icon.id].imx = icon.imx
            }
            if (icon.imy != undefined) {
                pages[pageid].icons[icon.id].imy = icon.imy
            }
            if (pages[pageid].owner == admin) {
                if (icon.imw != undefined) {
                    pages[pageid].icons[icon.id].imw = icon.imw
                }
                if (icon.imh != undefined) {
                    pages[pageid].icons[icon.id].imh = icon.imh
                }
                if (icon.path != undefined) {
                    pages[pageid].icons[icon.id].path = icon.path
                }
                if (icon.angle != undefined) {
                    pages[pageid].icons[icon.id].angle = icon.angle
                }
                if (icon.mainmap != undefined) {
                    pages[pageid].icons[icon.id].mainmap = icon.mainmap
                }
            }
            io.emit('icon', pages[pageid].icons[icon.id], pageid)
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
            if ((pages[pageid].owner != admin) && !pages[pageid].areas[area.id].player) { return }
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
        socket.on('getmarkers', (opts, pageid) => {
            if (!pages[pageid]) { return }
            if (opts.mainmap) {
                for (const i in pages[pageid].icons) {
                    if (pages[pageid].icons[i].mainmap) {
                        socket.emit('icon', pages[pageid].icons[i], pageid)
                    }
                }
            } else {
                for (const i in pages[pageid].markers) {
                    socket.emit('marker', pages[pageid].markers[i], pageid)
                }
                for (const i in pages[pageid].icons) {
                    socket.emit('icon', pages[pageid].icons[i], pageid)
                }
                for (const i in pages[pageid].effects) {
                    socket.emit('effect', pages[pageid].effects[i], pageid)
                }
                for (const i in pages[pageid].areas) {
                    socket.emit('area', pages[pageid].areas[i], pageid)
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
        save_pages()
    })
})


// async fire-and-forget functions

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

function checkfilename(upfile)
{
    if (upfile.name.length > 50 || upfile.name.match(/[^A-Za-z0-9._ -]/)) {
        console.log('upload', 'illegal filename', upfile.name)
        socket.emit('message', 'illegal filename: '+upfile.name)
        return false
    }
    if (!upfile.fileext.match(/^(gif|jpg|jpeg|png)$/)) {
        console.log('upload', 'illegal file extension', upfile.fileext)
        socket.emit('message', 'illegal file extension: '+upfile.fileext)
        return false
    }
    if (!upfile.id.match(/^[a-z0-9]*$/)) {
        console.log('upload', 'illegal file id', upfile.id)
        socket.emit('message', 'illegal file id: '+upfile.id)
        return false
    }
    return true
}

async function do_mapupload(socket, upmap, pageid)
{
    if (!checkfilename(upmap)) { return }
    if (upmap.filesize > maxmapsize) {
        console.log('mapupload', 'file too large', upmap.data.length)
        socket.emit('message', 'file too large: '+formatBytes(upmap.data.length)+' > '+formatBytes(maxmapsize))
        return
    }
    const mapfolder = './public/maps/'+pageid
    try {
        await fsp.mkdir(mapfolder, { recursive: true })
        for (const file of await fsp.readdir(mapfolder)) {
            const m = file.match(/^(.*?)-[0-9a-z][0-9a-z]+\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == upmap.name) {
                console.log('Removing for upload', mapfolder+'/'+file)
                await fsp.unlink(mapfolder+'/'+file)
            }
        }
        socket.emit('mapuploaddata', {
                id: upmap.id,
                name: upmap.name,
                fileext: upmap.fileext,
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
    if (!checkfilename(upmap)) { return }
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
                zoomre = new RegExp('^maps/'+pageid+'/'+map.name+'\\-[0-9a-z][0-9a-z]+\\.(jpeg|jpg|gif|png)$')
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

async function do_mapremove(socket, map, pageid)
{
    try {
        let done = false
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z][0-9a-z]+(?:-[bf])?\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == map.name) {
                const mappath = './public/maps/'+pageid+'/'+file
                console.log('Removing mapfile '+mappath)
                await fsp.unlink(mappath)
                console.log('File removed: '+mappath)
                io.emit('mapremove', { name: map.name }, pageid)
                done = true
            }
        }
        check_disk(true)
        if (!done) {
            socket.emit('mapremove', {
                name: map.name,
                error: 'Not found'
            }, pageid)
        }
    } catch (ex) {
        console.log('error deleting map', ex)
        socket.emit('message', 'Error deleting map: '+ex)
    }
}

async function do_mapedit(socket, map, pageid)
{
    /*
     * When the dm clicks 'edit', check if the map has already been edited
     * An edited map has multiple files:
     * - <mapname>-<id1>-f.<ext> : The complete map
     * - <mapname>-<id1>-b.<ext> : An empty map (optional)
     * - <mapname>-<id2>.<ext>   : The resulting edit (will be sent to players)
     *
     * A non-edited map just has the one file:
     * - <mapname>-<id>.<ext>
     *
     * The first time, copy map image to map-<id1>-f (new id)
     * When saving, the save will generate id2 for the resulting edit
     *
     * This function will start the edit, i.e. it will generate the f and b files
     *  and send all the paths to the client to start the edit
     */

    const mapfolder = './public/maps/'+pageid

    try {
        // Find all the edit files
        let mapfile = null
        let mapfore = null
        let mapback = null
        for (const file of await fsp.readdir(mapfolder)) {
            const m = file.match(/^(.*?)-[0-9a-z][0-9a-z]+(?:-(f|b))?\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == map.name) {
                if (m[2] == 'f') {
                    mapfore = file
                } else if (m[2] == 'b') {
                    mapback = file
                } else {
                    mapfile = file
                }
            }
        }
        console.log('mapedit found files', mapfore, mapback, mapfile)
        if (!mapfile && !mapfore) {
            socket.emit('message', 'mapedit map '+map.name+' not found')
            return
        }
        if (!mapfore) {
            const m = mapfile.match(/^(.*?)-[0-9a-z][0-9a-z]+\.(jpeg|jpg|gif|png)$/i)
            mapfore = m[1]+'-'+get_uid()+'-f.'+m[2]
            console.log('mapedit move to foreground file', mapfile, mapfore)
            await fsp.rename(mapfolder+'/'+mapfile, mapfolder+'/'+mapfore)
            mapfile = null
            // await fsp.copyFile(mapfolder+'/'+mapfile, mapfolder+'/'+mapfore)
        }
        socket.emit('mapedit', {
            name: map.name,
            fore: pageid+'/'+mapfore,
            back: (mapback ? pageid+'/'+mapback : null),
            file: (mapfile ? pageid+'/'+mapfile : null)
        }, pageid)
    } catch (ex) {
        if (ex.code != 'ENOENT') {
            console.log('mapedit error', ex)
            socket.emit('message', 'mapedit error on '+map.name+': '+ex)
        }
        return
    }
}

async function do_iconupload(socket, upicon, adminid)
{
    if (!checkfilename(upicon)) { return }
    if (upicon.filesize > maxiconsize) {
        console.log('iconupload', 'file too large', upicon.data.length)
        socket.emit('message', 'file too large: '+formatBytes(upicon.data.length)+' > '+formatBytes(maxiconsize))
        return
    }
    const iconfolder = './public/icons/'+adminid
    try {
        await fsp.mkdir(iconfolder, { recursive: true })
        for (const file of await fsp.readdir(iconfolder)) {
            const m = file.match(/^(.*?)\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == upicon.name) {
                console.log('Removing for upload', iconfolder+'/'+file)
                await fsp.unlink(iconfolder+'/'+file)
            }
        }
        socket.emit('iconuploaddata', {
                id: upicon.id,
                name: upicon.name,
                fileext: upicon.fileext,
                pos: 0
            })
    } catch (ex) {
        console.log('iconupload', 'Iconupload error: ', ex)
        socket.emit('message', 'Iconupload error: '+ex)
        return
    }
}

async function do_iconuploaddata(socket, upicon, adminid)
{
    if (!checkfilename(upicon)) { return }
    if ((diskusagebytes + upicon.data.length) > maxdiskuse) {
        console.log('iconupload', 'disk too full', diskusage, upicon.data.length)
        socket.emit('message', 'disk too full: '+diskusage+' + '+formatBytes(upicon.data.length) + ' > '+formatBytes(maxdiskuse))
        return
    }
    try {
        const iconpath = './public/icons/'+adminid+'/'+upicon.name+'.'+upicon.fileext
        let cursize = 0
        try {
            const fstat = await fsp.stat(iconpath)
            cursize = fstat.size
        } catch (ex) {
            if (ex.code != 'ENOENT') { throw(ex) }
        }
        if (cursize != upicon.pos) {
            console.log('iconupload size mismatch error: '+cursize+' <> '+upicon.pos)
            socket.emit('message', 'iconupload size mismatch error: '+cursize+' <> '+upicon.pos)
            return
        }
        console.log('Writing icon file', iconpath, upicon.data.length, 'at', upicon.pos)
        await fsp.appendFile(iconpath, upicon.data, 'Binary')
        diskusagebytes = diskusagebytes + upicon.data.length
        if (!upicon.finished) {
            socket.emit('iconuploaddata', {
                    id: upicon.id,
                    name: upicon.name,
                    fileext: upicon.fileext,
                    pos: upicon.pos + upicon.data.length
                })
            check_disk()
        } else {
            let icon = {
                path: adminid+'/'+upicon.name+'.'+upicon.fileext,
                name: upicon.name
            }
            io.emit('iconfile', icon)
            console.log('iconupload written', iconpath)
            save_pages()
            check_disk(true)
        }
    } catch (ex) {
        console.log('iconupload', 'Mapupload error: ', ex)
        socket.emit('message', 'Mapupload error: '+ex)
        return
    }
}

async function do_iconremove(socket, icon, adminid)
{
    try {
        let done = false
        for (const file of await fsp.readdir('./public/icons/'+adminid)) {
            const m = file.match(/^(.*?)\.(jpeg|jpg|gif|png)$/i)
            if (m && m[1] == icon.name) {
                const iconpath = './public/icons/'+adminid+'/'+file
                console.log('Removing iconfile '+iconpath)
                await fsp.unlink(iconpath)
                console.log('File removed: '+iconpath)
                socket.emit('iconremove', { name: icon.name })
                done = true
            }
        }
        check_disk(true)
        if (!done) {
            console.log('Remove icon not found', icon, adminid)
            socket.emit('iconremove', {
                name: icon.name,
                error: 'Not found'
            })
            do_sendicons(socket, adminid)
        }
    } catch (ex) {
        console.log('error deleting icon', ex)
        socket.emit('message', 'Error deleting icon: '+ex)
    }
}

async function do_map(socket, map, pageid)
{
    try {
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z][0-9a-z]+\.(jpeg|jpg|gif|png)$/i)
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
    socket.emit('page', pages[pageid], pageid)
    try {
        for (const file of await fsp.readdir('./public/maps/'+pageid)) {
            const m = file.match(/^(.*?)-[0-9a-z][0-9a-z]+(?:-f)?\.(jpeg|jpg|gif|png)$/i)
            if (m) {
                const mapname = m[1]
                const mapext = m[2]
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


async function do_sendicons(socket, adminid)
{
    try {
        for (const file of await fsp.readdir('./public/icons/'+adminid)) {
            const m = file.match(/^(.*?)\.(jpeg|jpg|gif|png)$/i)
            if (m) {
                const iconname = m[1]
                const iconpath = adminid+'/'+file
                socket.emit('iconfile', { name: iconname, path: iconpath })
            }
        }
    } catch (ex) {
        if (ex.code != 'ENOENT') {
            console.log('readmaps error', ex)
        }
    }
}

// Utility functions

function formatBytes(bytes)
{
    var sizes = ['B', 'KB', 'MB', 'GB']
    var si = 0
    while ((Math.abs(bytes) > 1024) && (si < (sizes.length-1))) {
        bytes = bytes / 1024
        si = si + 1
    }

    var bt = Math.floor(bytes * 100) / 100

    return bt+' '+sizes[si]
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
