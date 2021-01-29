$(load)

var dragging
var currentpageid = 'test'
var zoompos = {}
var adminonly = false

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
        document.body.className = 'connected'
        // console.log('page', page)
        currentpageid = page.id
        show_page(page)
    })
    socket.on('initiative', set_initiative)
    socket.on('marker', set_marker)
    socket.on('area', set_area)
    socket.on('effect', set_effect)
    socket.on('removearea', remove_area)
    socket.on('removeeffect', remove_effect)
    socket.on('zoom', function(zoom) {
        if (zoom.page == currentpageid) {
            set_zoom(zoom)
        }
    })
    socket.on('map', function(mapname) {
        $('#map img').attr('src', 'maps/'+mapname+'?'+get_uid())
    })
    socket.on('pages', function(pages) {
        document.body.className = 'connected'
        if (!adminonly) {
            adminonly = true
            $('.adminonly').show()
            socket.on('mapfile', add_mapfile)
            socket.on('mapremove', remove_mapfile)

            $('#fileupload').on('change','input[type="file"].mapimage', upload_map)

            $('#fileupload').on('input','input.mapnamenew', new_maprow)
            $('#fileupload').on('change', 'input.active', select_mapfile)
            $('#fileupload').on('click', '.remove.button.confirm', remove_map)
            $('#fileupload').on('click', '.remove.button', confirm_remove_map)
            $('#ini-title').on('click', '.editbutton', edit_characters)

            $('#ini-title').prepend('<input type="button" class="editbutton" value="">')
        }
    })
}

function edit_characters()
{
    if ($(this).val() == 'Save') {
        var iniorder = []
        $('#characters tr').each(function() {
            var tr = $(this)
            var cls = tr.attr('class')
            if (cls != 'deleteme') {
                var name = tr.find('td.name:not(.newrow) input')
                if (name.length) {
                    iniorder.push({
                        text: name.val(),
                        type: cls,
                        initiative: parseInt(tr.attr('data-initiative'))
                    })
                }
            }
        })
        socket.emit('initiative', { page: currentpageid, order: iniorder })
        $(this).val('Saving')
    } else if ($(this).val() == 'Edit') {
        $('#characters tr').each(function() {
            var tr = $(this)
            var nametd = tr.find('td.name')
            if (nametd.length) {
                tr.find('td.initiative').html('<input type="text" class="initiative" value="'+
                                                tr.attr('data-initiative')+'">')
                nametd.html('<input type="text" class="name" value="'+nametd.text()+'">')
                tr.append('<td class="chartype"><input type="text" class="chartype" value="'+
                                tr.attr('class')+'"></td>')

            }
        })
        add_character_newrow()
        $(this).val('Save')
    }
}

function add_character_newrow()
{
    $('#characters').append('<tr data-initiative="" class="">'+
        '<td class="initiative newrow"><input type="text" class="initiative" value=""></td>'+
        '<td class="name newrow"><input type="text" class="name" placeholder="New Entry" value=""></td>'+
        '<td class="chartype newrow"><input type="text" class="chartype" value="" placeholder="class"></td>'+
        '</tr>')
}

function add_character_row(e)
{
    if ($(this).val()) {
        var tr = $(this).closest('tr')
        tr.find('td.newrow').removeClass('newrow')
        add_character_newrow()
    }
}

var lastuid = 0

function get_uid()
{
    newid = new Date().getTime()
    if (newid < lastuid) { newid = lastuid+1 }
    lastuid = newid
    return newid.toString(36)
}

function set_initiative(initiative)
{
    if (initiative.page == currentpageid) {
        if (initiative.order) {
            var html = ['<tbody>']
            for (var i = 0; i < initiative.order.length; i++) {
                var item = initiative.order[i]
                html.push('<tr data-initiative="'+(item.initiative||'')+'" class="',item.type,
                    '"><td class="initiative">',(item.initiative||''),
                    '</td><td class="name">',item.text,'</td></tr>')
            }
            // html.push('<tr><td width= 50px;>&nbsp;</td><td width= 250px;>&nbsp;</td></tr>')
            html.push('</tbody>')
            $('#characters').html(html.join(''))
            $('#ini-title .editbutton').val('Edit')
        }
    }
}

function set_effect(effect)
{
    // console.log('effect', effect)
    if (effect.page != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var effecttr = $('#area-effects .aoe[data-id="'+effect.id+'"]')
    if (!effecttr.length) {
        effecttr = $(
            '<tr class="aoe" data-color="'+effect.color+'" data-page="'+effect.page+'" data-id="'+effect.id+'">'+
            '<td class="aoe-text" style="background-color:'+effect.color+';">'+
            '<input type="text" placeholder="Area of Effect"></td>'+
            '<td class="aoe-close">X</td></tr>').prependTo('#area-effects')
    }
    if (!effecttr.is(':focus')) {
        effecttr.find('input').val(effect.text)
    }
}

function set_area(area)
{
    // console.log('area', area)
    if (area.page != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var areadiv = $('#zoomoverlay .aoe[data-id="'+area.id+'"]')
    if (!areadiv.length) {
        areadiv = $('<div class="'+area.cls+'" style="left:'+x+'px; top:'+y+'px; width:'+w+'px; height:'+h+'px; background-color:'+area.color+';" data-color="'+area.color+'" data-id="'+area.id+'" data-page="'+area.page+'"></div>').appendTo('#zoomoverlay')
    }
    var zof = $('#zoomoverlay').offset()
    var x = area.imx * zoompos.w + zoompos.x - zof.left
    var y = area.imy * zoompos.h + zoompos.y - zof.top
    var w = area.imw * zoompos.w
    var h = area.imh * zoompos.h
    areadiv.css({left: x+'px', top: y+'px', width: w+'px', height: h+'px'})
}

function set_marker(marker)
{
    if (marker.page != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var markerdiv = $('#markers .marker[data-id="'+marker.id+'"]')
    if (!markerdiv.length) {
        markerdiv = $('<div data-page="'+marker.page+'" data-id="'+marker.id+'" class="'+marker.cls+'">'+marker.text+'</div>').appendTo('#markers')
    }
    var x = marker.imx * zoompos.w + zoompos.x - markerdiv.width()/2
    var y = marker.imy * zoompos.h + zoompos.y - markerdiv.height()/2
    markerdiv.css({left:x+'px',top:y+'px'})
}

function show_page(page)
{
    if (page.zoom) {
        set_zoom(page.zoom)
    }
    if (page.markers) {
        for (mr in page.markers) {
            set_marker(page.markers[mr])
        }
    }
    if (page.areas) {
        for (ar in page.areas) {
            set_area(page.areas[ar])
        }
    }
    if (page.effects) {
        for (ar in page.effects) {
            set_effect(page.effects[ar])
        }
    }
    if (page.maps) {
        for (mf in page.maps) {
            add_mapfile(page.maps[mf])
        }
    }
    if (page.initiative) {
        set_initiative({page: currentpageid, order: page.initiative})
    }
    if (page.token) {
        var playerlink = window.location.origin+'#'+page.token
        $('#playerlink a').text(playerlink)
        $('#playerlink a').attr('href', playerlink)
    }
}

function load() {
    $('#map img').on('mousedown', select_map)
    $('#zoomclose').click(hide_zoom)
    $('#zoomoverlay').on('mousedown', select_aoe)
    $('#characters').on('mousedown', function(e) { if (e.which == 1) return false })
    $('#characters').on('mousedown', 'tr', start_marker)
    $('#markers').on('mousedown', '.marker', drag_marker)
    set_aoe_styles()
    $('td.area-effects').on('click','div', add_aoe)
    $('#area-effects').on('click','tr.aoe td.aoe-close', close_aoe)
    $('#area-effects').on('input','input', oninput_effect)
    $('#area-effects').on('change','input', emit_effect)

    $('#characters').on('mousedown', 'input', function(e) { e.stopPropagation() })
    $('#characters').on('keyup','input', check_updown)
    $('#characters').on('input','input.initiative', check_ordering)
    $('#characters').on('input','td.newrow input', add_character_row)
    $('#characters').on('input','td.chartype input', set_character_class)
}

function set_character_class(e)
{
    $(this).closest('tr').attr('class', ($(this).val() || 'deleteme'))
}

function check_ordering(e)
{
    var tr = $(this).closest('tr')
    var ini = parseInt($(this).val().replace(/^([^0-9-]*)/,''))
    if (isNaN(ini)) {
        tr.attr('data-initiative', '')
        return
    }
    tr.attr('data-initiative', ini)

    // Look up
    var tr_to = tr
    var domove = false
    while (tr_to.length) {
        var ini_to = NaN
        var trprev = tr_to
        while (trprev.length && isNaN(ini_to)) {
            trprev = trprev.prev()
            ini_to = parseInt(trprev.attr('data-initiative'), 10)
        }
        if (!trprev.length || (ini_to >= ini)) {
            if (domove) {
                tr.insertBefore(tr_to)
                $(this).focus()
                return
            }
            break
        }
        // Mark that we passed a row
        domove = true
        tr_to = trprev
    }

    // Look down
    tr_to = tr
    domove = false
    while (tr_to.length) {
        var ini_to = NaN
        var trnext = tr_to
        while (trnext.length && isNaN(ini_to)) {
            trnext = trnext.next()
            ini_to = parseInt(trnext.attr('data-initiative'), 10)
        }
        if (!trnext.length || (ini_to <= ini)) {
            if (domove) {
                tr.insertAfter(tr_to)
                $(this).focus()
                return
            }
            break
        }
        // Mark that we passed a row
        domove = true
        tr_to = trnext
    }
}

function check_updown(e)
{
    // console.log(e.which, e)
    if (e.which == 38) { // UP
        var tr = $(this).closest('tr')
        var ptr = tr.prev()
        if (ptr.length) {
            tr.insertBefore(ptr)
            $(this).focus()
        }
    }
    if (e.which == 40) { // DOWN
        var tr = $(this).closest('tr')
        var ntr = tr.next()
        if (ntr.length) {
            tr.insertAfter(ntr)
            $(this).focus()
        }
    }
}

function confirm_remove_map(e)
{
    var btn = $(this)
    btn.addClass('confirm')
    btn.text('Remove')
    setTimeout(function() {
        btn.removeClass('confirm')
        btn.text('X')
    }, 5000)
}

function remove_map(e)
{
    var tr = $(this).closest('tr')
    socket.emit('mapremove', { page: tr.attr('data-page'), name: tr.attr('data-name')})
}

function select_mapfile(e)
{
    var tr = $(this).closest('tr')
    socket.emit('map', { page: tr.attr('data-page'), name: tr.attr('data-name')})
}

function new_maprow(e)
{
    if ($(this).val()) {
        var tr = $(this).closest('tr')
        tr.append('<td><label><div class="upload button">browse</div>'+
            '<input name="mapimage" type="file" class="mapimage" value="Map" '+
            'accept=".jpg,.png,.gif,image/*"></label></td>')
        $(this).removeClass('mapnamenew').addClass('mapname')
        $(this).closest('tbody').append('<tr class="mapupload">'+
            '<td><input class="active" type="radio" name="mapactive"></td>'+
            '<td class="mapname"><input class="mapnamenew" type="text" placeholder="New Map Name"></td>'+
            '</tr>')
        tr.attr('data-name', $(this).val())
    }
}

function add_mapfile(map)
{
    var mapfileent = $('#fileupload tr.mapupload[data-page="'+map.page+'"][data-name="'+map.name+'"]')
    if (!mapfileent.length) {
        mapfileent = $('<tr class="mapupload" data-name="'+map.name+'" data-page="'+map.page+'">'+
                          '<td><input class="active" type="radio" name="mapactive" '+(map.active?'checked':'')+'></td>'+
                          '<td class="mapname">'+map.name+'</td>'+
                          '<td><label><div class="upload button">browse</div>'+
                          '<input name="mapimage" type="file" class="mapimage" value="Map" '+
                          'accept=".jpg,.png,.gif,image/*"></label></td>'+
                          '<td class="removemap"><div class="remove button">X</div></td>'+
                       '</tr>').insertBefore('#fileupload tr.mapuploadnew')
    }
}

function remove_mapfile(map)
{
    $('#fileupload tr.mapupload[data-page="'+map.page+'"][data-name="'+map.name+'"]').remove()
}

function upload_map(e)
{
    var fileinp = $(this)
    var filetr = fileinp.closest('tr')
    var file = this.files[0]
    if (file.size > 10000000) {
        // alert('File '+file.name+' too big: '+file.size)
        filetr.addClass('failed')
        return
    }
    var nameinput = filetr.find('input.mapname')
    if (nameinput.length) {
        var inputval = nameinput.val()
        filetr.attr('data-name', inputval)
        filetr.attr('data-page', currentpageid)
        nameinput.closest('td').text(inputval)
        filetr.append('<td class="removemap"><div class="remove button">X</div></td>')
    }
    var filename = filetr.attr('data-name')
    var filepage = filetr.attr('data-page')
    var active = filetr.find('input.active').is(':checked')
    var fileext = file.name.replace(/.*\./,'')
    var reader = new FileReader()
    filetr.removeClass('failed').addClass('uploading')
    reader.onload = function(e) {
        var data = e.target.result
        socket.emit('mapupload', {page: filepage, name: filename, fileext: fileext, data: data, active: active})
        filetr.removeClass('uploading')
    }
    reader.readAsBinaryString(file)
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
        aoe = $('<tr class="aoe" data-color="'+color+'" data-page="'+currentpageid+'" data-id="'+get_uid()+'"><td class="aoe-text" style="background-color: '+color+';"><input type="text" placeholder="Area of Effect"></td><td class="aoe-close">X</td></tr>').prependTo('#area-effects')
    }
    aoe.find('input').focus()
    $('#area-effects td.area-effects div.selected').removeClass('selected')
    $(this).addClass('selected')
    $('#zoomoverlay').addClass('draw-aoe')
    socket.emit('effect', {
        id:     aoe.attr('data-id'),
        page:   aoe.attr('data-page'),
        color:  aoe.attr('data-color'),
        text:   aoe.find('input').val(),
        player: true
    })
    return false
}

var nexteffectsend = 0

function oninput_effect()
{
    var now = new Date().getTime()
    var inp = $(this)
    if (nexteffectsend < now) {
        var to = inp.attr('data-timeout')
        if (to) {
            inp.attr('data-timeout', null)
            clearTimeout(to)
        }
        emit_effect.apply(this)
        nexteffectsend = now + 200
    } else {
        var to = inp.attr('data-timeout')
        if (to) {
            clearTimeout(to)
        }
        to = setTimeout(function() {
            oninput_effect.apply(inp)
        }, 200)
        inp.attr('data-timeout', to)
    }
}

function emit_effect()
{
    var inp = $(this)
    var aoe = inp.closest('tr.aoe')
    socket.emit('effect', {
        id:    aoe.attr('data-id'),
        page:  aoe.attr('data-page'),
        color: aoe.attr('data-color'),
        text:  inp.val(),
        player: true
    })
}

function close_aoe()
{
    var tr = $(this).parent('tr')
    socket.emit('removeeffect', {
        page:   tr.attr('data-page'),
        id:     tr.attr('data-id')
    })
}

function remove_area(area)
{
    // console.log('remove_area', area)
    if (area.page != currentpageid) { return }
    $('#zoomoverlay .aoe[data-id="'+area.id+'"]').remove()
}

function remove_effect(effect)
{
    // console.log('remove_effect', effect)
    var effecttr = $('#area-effects .aoe[data-id="'+effect.id+'"]')
    effecttr.remove()
    $('#area-effects div.selected').removeClass('selected')

    /*
    var color = tr.attr('data-color')
    $('#zoomoverlay div.aoe[data-color="'+color+'"]').remove()
    $('#area-effects div.selected').removeClass('selected')
    */
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
        zoom.append('<div class="aoe dragging area-square" data-id="'+get_uid()+'" data-page="'+currentpageid+'" data-color="'+color+'" style="background-color: '+color+';"/>')
        zoom.on('mousemove', size_aoe_square).on('mouseup', show_aoe_square)
    } else if (par.hasClass('area-circle')) {
        zoom.append('<div class="aoe dragging area-circle" data-id="'+get_uid()+'" data-page="'+currentpageid+'" data-color="'+color+'" style="background-color: '+color+';"/>')
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
    var aoe = $('#zoomoverlay div.aoe.dragging')
    aoe.removeClass('dragging')

    emit_area(aoe)
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
    var aoe = $(this)
    $(this).off('mousemove').off('mouseup')
    $('#zoomoverlay').removeClass('draw-aoe')
    $('#area-effects td.area-effects div.selected').removeClass('selected')
    var aoe = $('#zoomoverlay div.aoe.dragging')
    aoe.removeClass('dragging')

    emit_area(aoe)
    return false
}

function emit_area(aoe)
{
    var of = aoe.offset()
    var imx = (of.left - zoompos.x) / zoompos.w
    var imy = (of.top  - zoompos.y) / zoompos.h
    var imw = aoe.width() / zoompos.w
    var imh = aoe.height() / zoompos.h
    socket.emit('area', {
        id:    aoe.attr('data-id'),
        page:  aoe.attr('data-page'),
        cls:   aoe.attr('class'),
        imx:   imx,
        imy:   imy,
        imw:   imw,
        imh:   imh,
        color: aoe.attr('data-color'),
        player: true
    })
}

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
        marker = $('<div data-page="'+currentpageid+'" data-id="'+get_uid()+'" class="'+cls.join(' ')+'">'+mid+'</div>').appendTo('#markers')
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

        var imx = (e.pageX - zoompos.x)/zoompos.w
        var imy = (e.pageY - zoompos.y)/zoompos.h
        var now = new Date().getTime()
        if (nextmovesend < now) {
            socket.emit('marker', {
                id:     marker.attr('data-id'),
                page:   marker.attr('data-page'),
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
        var imx = (e.pageX - zoompos.x)/zoompos.w
        var imy = (e.pageY - zoompos.y)/zoompos.h
        socket.emit('marker', {
            id:     marker.attr('data-id'),
            page:   marker.attr('data-page'),
            imx:    imx,
            imy:    imy,
            text:   marker.text(),
            player: marker.hasClass('pc'),
            cls:    marker.attr('class')
        })
        $(window).off('mousemove').off('mouseup')
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
    var zpo = $('#zoom img').offset()
    zoompos = {
        x: zpo.left,
        y: zpo.top,
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
    if ($('#zoompopup').is(':visible')) {
        $('#selector').hide()
        $('#zoompopup').hide()
        $('#markers').html('')
        $('#zoomoverlay div.aoe').remove()
        $('#area-effects tr.aoe').remove()
        socket.emit('zoom', { page: currentpageid, x: 0, y: 0, w: 0, h: 0 })
    }
}
