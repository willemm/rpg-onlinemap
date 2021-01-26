$(load)

var dragging
var currentpageid = 'test'
var zoompos = {}

const socket = io()
setup_socket(socket)

function setup_socket(socket)
{
    var token = window.location.hash.replace(/^#/,'')
    socket.on('connect', function() {
        socket.emit('join', token)
        document.body.className = 'connecting'
    })
    socket.on('disconnect', function() {
        document.body.className = 'disconnected'
    })
    socket.on('page', function(page) {
        console.log('page', page)
        currentpageid = page.id
    })
    socket.on('pages', function(pages) {
        console.log('pages', pages)
    })
    socket.on('gotopage', function(pageid) {
        console.log('gotopage', pageid)
        currentpageid = pageid
    })
    socket.on('movemarker', function(marker) {
        console.log('movemarker', marker)
        if (marker.page != currentpageid) { return }
        var markerdiv = $('#markers .marker[myid="'+marker.id+'"]')
        if (!markerdiv.length) {
            markerdiv = $('<div mypage="'+marker.page+'" myid="'+marker.id+'" class="'+marker.cls+'">'+marker.text+'</div>').appendTo('#markers')
        }
        var x = marker.imx * zoompos.w + zoompos.x
        var y = marker.imy * zoompos.h + zoompos.y
        markerdiv.css({left:x+'px',top:y+'px'})
        console.log('marker', markerdiv, x, y)
    })
    socket.on('zoom', function(zoom) {
        console.log('zoom', zoom)
        if (zoom.page == currentpageid) {
            set_zoom(zoom)
        }
    })
}

function load() {
    $('#map img').on('mousedown', select_map)
    $('#zoomclose').click(hide_zoom)
    $('#zoomoverlay').on('mousedown', select_aoe)
    $('#characters').on('mousedown', function(e) { if (e.which == 1) return false })
    $('#characters').on('mousedown', 'tr', start_marker)
    $('#markers').on('mousedown', '.marker', drag_marker)
    /*
    set_zoom(getData('mapzoom'))
    set_markers(getData('mapmarkers'))
    set_areas(getData('mapareas'))
    set_effects(getData('mapeffects'))
    */
    set_aoe_styles()
    $('td.area-effects').on('click','div', add_aoe)
    $('#area-effects').on('click','tr.aoe td.aoe-close', close_aoe)
    $('#area-effects').on('change','input', save_effects)
}

function set_aoe_styles()
{
    $('td.area-effects div').each(function() {
        var opt = $(this)
        var color = opt.text().trim()
        opt.css('background-color', color)
        opt.attr('data-color', color)
        opt.html('')
    })
}

function add_aoe()
{
    if ($(this).hasClass('selected')) {
        $(this).removeClass('selected')
        $('#zoomoverlay').removeClass('draw-aoe')
        return false
    }
    if (!$('#zoompopup').is(':visible')) return false
    var color = $(this).attr('data-color')
    var aoe = $('#area-effects tr[data-color="'+color+'"]')
    if (aoe.length == 0) {
        aoe = $('<tr class="aoe" data-color="'+color+'"><td class="aoe-text" style="background-color: '+color+';"><input type="text" placeholder="Area of Effect"></td><td class="aoe-close">X</td></tr>').prependTo('#area-effects')
    }
    aoe.find('input').focus()
    $('#area-effects td.area-effects div.selected').removeClass('selected')
    $(this).addClass('selected')
    $('#zoomoverlay').addClass('draw-aoe')
    save_effects()
    return false
}

function close_aoe()
{
    var tr = $(this).parent('tr')
    var color = tr.attr('data-color')
    $('#zoomoverlay div.aoe[data-color="'+color+'"]').remove()
    tr.remove()
    save_effects()
    save_areas()
    $('#area-effects div.selected').removeClass('selected')
}

function select_aoe(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var sel = $('#area-effects td.area-effects div.selected')
    var color = sel.attr('data-color')
    if (!color) return false
    var zoom = $('#zoomoverlay')
    dragging = { x: e.pageX + zoom.scrollLeft(), y: e.pageY + zoom.scrollTop() }
    var par = sel.parent('td.area-effects')
    if (par.hasClass('area-square')) {
        zoom.append('<div class="aoe dragging area-square" data-color="'+color+'" style="background-color: '+color+';"/>')
        zoom.on('mousemove', size_aoe_square).on('mouseup', show_aoe_square)
    } else if (par.hasClass('area-circle')) {
        zoom.append('<div class="aoe dragging area-circle" data-color="'+color+'" style="background-color: '+color+';"/>')
        zoom.on('mousemove', size_aoe_circle).on('mouseup', show_aoe_circle)
    }
    return false
}

function size_aoe_square(e)
{
    var elem = $('#zoomoverlay')
    var xc = dragging.x
    var yc = dragging.y
    var xs = Math.abs(e.pageX + elem.scrollLeft() - xc)
    var ys = Math.abs(e.pageY + elem.scrollTop() - yc)
    xc -= xs
    yc -= ys
    xs *= 2
    ys *= 2

    var mappos = elem.offset()
    xc -= mappos.left
    yc -= mappos.top

    $('#zoomoverlay div.aoe.dragging').css({left:xc+'px',top:yc+'px',width:xs+'px',height:ys+'px'})
    return false
}

function show_aoe_square(e)
{
    size_aoe_square(e)
    $(this).off('mousemove').off('mouseup')
    $('#zoomoverlay').removeClass('draw-aoe')
    $('#area-effects td.area-effects div.selected').removeClass('selected')
    $('#zoomoverlay div.aoe.dragging').removeClass('dragging')
    save_areas()
    return false
}

function size_aoe_circle(e)
{
    var elem = $('#zoomoverlay')
    var xc = dragging.x
    var yc = dragging.y
    var xs = e.pageX + elem.scrollLeft() - xc
    var ys = e.pageY + elem.scrollTop() - yc
    var sz = Math.round(Math.sqrt(xs*xs + ys*ys))
    xc -= sz
    yc -= sz
    sz *= 2

    var mappos = elem.offset()
    xc -= mappos.left
    yc -= mappos.top

    $('#zoomoverlay div.aoe.dragging').css({left:xc+'px',top:yc+'px',width:sz+'px',height:sz+'px'})
    return false
}

function show_aoe_circle(e)
{
    size_aoe_circle(e)
    $(this).off('mousemove').off('mouseup')
    $('#zoomoverlay').removeClass('draw-aoe')
    $('#area-effects td.area-effects div.selected').removeClass('selected')
    $('#zoomoverlay div.aoe.dragging').removeClass('dragging')
    save_areas()
    return false
}

function save_areas()
{
    /*
    var areas = $('#zoomoverlay .aoe').map(function() {
        var e = $(this)
        return [ e.attr('class'), e.css('left'), e.css('top'), e.css('width'), e.css('height'), e.attr('data-color') ]
    }).get()
    setData('mapareas', areas)
    */
}

function set_areas(areas)
{
    if (!areas) return
    var html = []
    for (var i = 0; i < areas.length; i += 6) {
        html.push('<div class="',areas[i+0],'" style="left:',areas[i+1],'; top:',areas[i+2],'; width:',areas[i+3],'; height:',areas[i+4],'; background-color:',areas[i+5],';" data-color="',areas[i+5],'"></div>')
    }
    $('#zoomoverlay').append(html.join(''))
}

function save_effects()
{
    /*
    var effects = $('#area-effects tr.aoe').map(function() {
        var e = $(this)
        return [ e.attr('data-color'), e.find('input').val() ]
    }).get()
    setData('mapeffects', effects)
    */
}

function set_effects(effects)
{
    if (!effects) return
    var html = []
    for (var i = 0; i < effects.length; i += 2) {
        html.push('<tr class="aoe" data-color="',effects[i],'">')
        html.push('<td class="aoe-text" style="background-color:',effects[i],';">')
        html.push('<input type="text" placeholder="Area of Effect" value="',effects[i+1],'"></td>')
        html.push('<td class="aoe-close">X</td></tr>')
    }
    $('#area-effects').prepend(html.join(''))
}

function save_markers()
{
    /*
    var markers = $('#markers .marker').map(function() {
        var e = $(this)
        return [ e.attr('class'), e.css('left'), e.css('top'), e.text() ]
    }).get()
    setData('mapmarkers', markers)
    */
}

function set_markers(markers)
{
    if (!markers) return
    var html = []
    for (var i = 0; i < markers.length; i += 4) {
        html.push('<div class="',markers[i+0],'" style="left:',markers[i+1],'; top:',markers[i+2],';">',markers[i+3],'</div>')
    }
    $('#markers').html(html.join(''))
}

var lastmarker = 0

function start_marker(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var multi = false

    var ch = $(this)
    var mid = ch.find('td:nth-child(2)').text().trim()
    var cls = ['marker']

    cls.push('char_'+mid.replace(/[^A-Za-z0-9]/g,'_'))
    if (ch.hasClass('pc')) {
        cls.push('pc')
    } else {
        cls.push('npc')
        multi = true
    }
    mid = mid[0]
    if (mid) {
        var marker = $('#markers .'+cls.join('.'))
        if (marker.length) {
            if (multi) {
                if (marker.length == 1) {
                    marker.text('1')
                }
                mid = marker.length + 1
            } else {
                marker.remove()
            }
        }
        cls.push(ch.attr('class'))
        markerid = new Date().getTime()
        if (markerid < lastmarker) { markerid = lastmarker+1 }
        lastmarker = markerid
        markerid = markerid.toString(36)
        marker = $('<div mypage="'+currentpageid+'" myid="'+markerid+'" class="'+cls.join(' ')+'">'+mid+'</div>').appendTo('#markers')
        drag_marker.apply(marker, [e])
    }
    return false
}

var nextmovesend = 0

function drag_marker(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var marker = $(this)
    $(window).on('mousemove', function(e) {
        var x = (e.pageX-marker.width()/2)
        var y = (e.pageY-marker.height()/2)
        marker.css({left:x+'px',top:y+'px'})

        var imx = (x - zoompos.x)/zoompos.w
        var imy = (y - zoompos.y)/zoompos.h
        var now = new Date().getTime()
        if (nextmovesend < now) {
            socket.emit('movemarker', {
                id:     marker.attr('myid'),
                page:   marker.attr('mypage'),
                imx:    imx,
                imy:    imy,
                text:   marker.text(),
                player: marker.hasClass('pc'),
                cls:    marker.attr('class')
            })
            nextmovesend = now + 200
        }
        return false
    }).on('mouseup', function(e) {
        var x = (e.pageX-marker.width()/2)
        var y = (e.pageY-marker.height()/2)
        marker.css({left:x+'px',top:y+'px'})
        var imx = (x - zoompos.x)/zoompos.w
        var imy = (y - zoompos.y)/zoompos.h
        socket.emit('movemarker', {
            id:     marker.attr('myid'),
            page:   marker.attr('mypage'),
            imx:    imx,
            imy:    imy,
            text:   marker.text(),
            player: marker.hasClass('pc'),
            cls:    marker.attr('class')
        })
        $(window).off('mousemove').off('mouseup')
        save_markers()
        return false
    })
    return false
}

function select_map(e) {
    if (e.which != 1) return
    if ($('#zoompopup').is(':visible')) return false
    var map = $('#map')
    dragging = { x: e.pageX + map.scrollLeft(), y: e.pageY + map.scrollTop() }
    map.on('mousemove', size_map).on('mouseup', show_zoom)
    return false
}

function selector_pos(e, elem) {
    var x1 = dragging.x
    var y1 = dragging.y
    var x2 = e.pageX + elem.scrollLeft()
    var y2 = e.pageY + elem.scrollTop()
    var w = Math.abs(x2 - x1)
    var h = Math.abs(y2 - y1)
    if (x2 < x1) x1 -= w
    if (y2 < y1) y1 -= h
    var mappos = elem.offset()
    x1 -= mappos.left
    y1 -= mappos.top
    return { x: x1, y: y1, w: w, h: h, page: currentpageid }
}

function size_map(e) {
    var sp = selector_pos(e, $('#map'))
    $('#selector').show().css({left:sp.x+'px',top:sp.y+'px',width:sp.w+'px',height:sp.h+'px'})
    return false
}

function show_zoom(e) {
    $(this).off('mousemove').off('mouseup')
    var zoom = selector_pos(e, $('#map'))
    socket.emit('zoom', zoom)
    set_zoom(zoom)
}

function set_zoom(sp) {
    if (!sp || sp.w < 20 || sp.h < 20) {
        return hide_zoom()
    }
    // setData('mapzoom',sp)
    var zoomw = $('#zoompopup').width()
    var zoomh = $('#zoompopup').height()
    var scalex = zoomw / sp.w
    var scaley = zoomh / sp.h
    var scale
    var zoomx = 0
    var zoomy = 0
    if (scalex > scaley) {
        var neww = zoomw * scaley / scalex
        zoomx = Math.round((zoomw - neww) / 2)
        zoomw = Math.round(neww)
        scale = scaley
    } else {
        var newh = zoomh * scalex / scaley
        zoomy = Math.round((zoomh - newh) / 2)
        zoomh = Math.round(newh)
        scale = scalex
    }
    var img = $('#map img')
    $('#zoom').css({width: zoomw+'px', height: zoomh+'px', left: zoomx+'px', top: zoomy+'px'})
    $('#zoom').html('<img src="'+img.attr('src')+'">')
    $('#zoomoverlay').css({width: zoomw+'px', height: zoomh+'px', left: zoomx+'px', top: zoomy+'px'})
    $('#zoomclose').css({right: (zoomx-40)+'px', top: zoomy+'px'})
    var iw = img.width() * scale
    var ih = img.height() * scale
    var ix = -sp.x * scale
    var iy = -sp.y * scale
    $('#zoom img').css({left:ix+'px', top:iy+'px', width: iw+'px', height: ih+'px'})
    $('#zoompopup').show()
    $('#selector').hide()
    var zpo = $('#zoompopup').offset()
    zoompos = {
        x: zoomx + ix + zpo.left,
        y: zoomy + iy + zpo.top,
        w: iw,
        h: ih
    }
    return false
}

function hide_zoom()
{
    /*
    eraseData('mapzoom')
    eraseData('mapmarkers')
    eraseData('mapareas')
    eraseData('mapeffects')
    */
    $('#selector').hide()
    $('#zoompopup').hide()
    $('#markers').html('')
    $('#zoomoverlay div.aoe').remove()
    $('#area-effects tr.aoe').remove()
}

/*
function setData(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value))
}

function getData(key) {
    return JSON.parse(sessionStorage.getItem(key))
}

function eraseData(key) {
    sessionStorage.removeItem(key)
}
*/
