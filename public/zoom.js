$(load)

var dragging
var currentpageid
var zoompos = {}
var adminonly = false

var charclasslist

const socket = io()
setup_socket(socket)

function setup_socket(socket)
{
    socket.on('connect', function() {
        var token = window.location.hash.replace(/^#/,'')
        socket.emit('join', token)
        $(document.body).removeClass('disconnected connecting connected').addClass('connecting')
    })
    socket.on('disconnect', function() {
        $(document.body).removeClass('disconnected connecting connected').addClass('disconnected')
    })
    socket.on('page', function(page, pageid) {
        $(document.body).removeClass('disconnected connecting connected').addClass('connected')
        if (pageid || !page) {
            currentpageid = pageid
            sessionStorage.setItem('currentpageid', pageid)
        } else if (page && page.id != currentpageid) {
            return
        }
        if (page && adminonly) {
            $('#pagetitle').attr('placeholder', 'Session title')
            $('.editonly').show()
        } else {
            $('#pagetitle').attr('placeholder', 'Select session')
            $('.editonly').hide()
        }
        show_page(page || {})
    })
    socket.on('initiative', set_initiative)
    socket.on('marker', set_marker)
    socket.on('icon', set_icon)
    socket.on('area', set_area)
    socket.on('effect', set_effect)
    socket.on('removearea', remove_area)
    socket.on('removeeffect', remove_effect)
    socket.on('zoom', function(zoom, pageid) {
        if (pageid == currentpageid) {
            set_zoom(zoom)
        }
    })
    socket.on('map', set_map)
    socket.on('mapfile', add_mapfile)
    socket.on('mapremove', remove_mapfile)
    socket.on('iconfile', add_iconfile)
    socket.on('iconremove', remove_iconfile)
    socket.on('pagetitle', set_pagetitle)
    socket.on('diskusage', function(diskusage) {
        $('#diskusage').text(diskusage)
    })

    socket.on('pages', get_pages)
    socket.on('freeze', set_freeze)
}

function get_pages(pages)
{
    $(document.body).removeClass('disconnected connecting connected').addClass('connected')
    if (!adminonly) {
        adminonly = true
        $('.adminonly').show()

        $('#fileupload').on('change','input[type="file"].uploadfile', upload_map)
        $('#newmapicon').on('change','input[type="file"].uploadfile', upload_icon)

        $('#fileupload').on('input','input.mapnamenew', new_maprow)
        $('#fileupload').on('change', 'input.active', select_mapfile)
        $('#fileupload').on('click', '.remove.button.confirm', remove_map)
        $('#fileupload').on('click', '.remove.button', confirm_remove_map)
        $('#ini-title').on('click', '.editbutton', edit_characters)

        $('#configbutton').click(function(e) { $('#configurations .configs').toggle() })
        $('#freezepage').click(function(e) { socket.emit('freeze', true, currentpageid) })
        $('#thawpage').click(function(e) { socket.emit('freeze', false, currentpageid) })
        $('#deletepage').click(delete_page)

        $('#markers').on('contextmenu', '.marker', show_marker_menu)
        $('#markers').on('mousedown', '.markermenu,.mapiconmenu', function(e) { e.stopPropagation() })
        $('#markers').on('click', '.markermenu .menuitem', send_marker_menu)

        $('#markers').on('contextmenu', '.mapicon img', show_mapicon_menu)
        $('#markers').on('click', '.mapiconmenu .menuitem', send_mapicon_menu)
        $('#markers').on('mousedown', '.mapiconmenu .rotateicon', rotate_mapicon)

        $('#ini-title').prepend('<input type="button" class="editbutton" value="">')
        socket.on('message', function(err) {
            alert(err)
        })
        socket.on('mapuploaddata', upload_map_data)
        socket.on('iconuploaddata', upload_icon_data)
    }
    var options = []
    for (var p = 0; p < pages.length; p++) {
        options.push('<option data-title="'+pages[p].title+'" value="'+pages[p].id+'">'+
            pages[p].title+'</option>')
    }
    options.sort()
    options.push('<option value="new">New</option>')
    $('#pageselect').html(options.join(''))
    $('#pageselect').val('')
    var storedpageid = sessionStorage.getItem('currentpageid')
    if (storedpageid) {
        socket.emit('selectpage', storedpageid)
    }
    if (currentpageid) {
        $('#pagetitle').attr('placeholder', 'Session title')
        $('.editonly').show()
    }
}

function delete_page()
{
    var pageid = currentpageid
    if (pageid) {
        if (prompt('Remove the session '+document.title+" ?\nThis is permanent! Type 'yes' to confirm") == 'yes') {
            socket.emit('deletepage', pageid)
        }
    }
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
                        id: tr.attr('data-id') || get_uid(),
                        initiative: parseInt(tr.attr('data-initiative'))
                    })
                }
            }
        })
        socket.emit('initiative', { order: iniorder }, currentpageid)
        $(this).val('Saving')
    } else if ($(this).val() == 'Edit') {
        $('#characters tr').each(function() {
            var tr = $(this)
            var nametd = tr.find('td.name')
            if (nametd.length) {
                tr.find('td.initiative').html('<input type="text" class="initiative" value="'+
                                                tr.attr('data-initiative')+'">')
                nametd.html('<input type="text" class="name" value="'+nametd.text()+'">')
                if (charclasslist) {
                    tr.append('<td class="chartype"><select class="chartype">'+
                            '<option value="'+tr.attr('class')+'" selected>'+tr.attr('class')+'</option>'+
                            charclasslist+'</select></td>')
                } else {
                    tr.append('<td class="chartype"><input type="text" class="chartype" value="'+
                                tr.attr('class')+'"></td>')
                }

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
        '<td class="chartype newrow">'+
        (charclasslist ? '<select class="chartype"><option value=""></option>'+charclasslist+'</select>' :
            '<input type="text" class="chartype" value="" placeholder="class">')+
        '</td>'+
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
    if (newid <= lastuid) { newid = lastuid+1 }
    lastuid = newid
    return newid.toString(36)
}

function set_initiative(initiative, pageid)
{
    if (pageid != currentpageid) { return }
    if (initiative) {
        var html = ['<tbody>']
        for (var i = 0; i < initiative.length; i++) {
            var item = initiative[i]
            html.push('<tr data-initiative="'+(item.initiative||'')+
                '" data-id="'+(item.id||'')+'" class="',item.type,
                '"><td class="initiative">',(item.initiative||''),
                '</td><td class="name">',item.text,'</td></tr>')
        }
        // html.push('<tr><td width= 50px;>&nbsp;</td><td width= 250px;>&nbsp;</td></tr>')
        html.push('</tbody>')
        $('#characters').html(html.join(''))
        $('#ini-title .editbutton').val('Edit')
    } else {
        $('#characters').html('')
        $('#ini-title .editbutton').val('')
    }
}

function set_effect(effect, pageid)
{
    if (pageid != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var effecttr = $('#area-effects .aoe[data-id="'+effect.id+'"]')
    if (!effecttr.length) {
        effecttr = $(
            '<tr class="aoe" data-color="'+effect.color+'" data-page="'+pageid+'" data-id="'+effect.id+'">'+
            '<td class="aoe-text" style="background-color:'+effect.color+';">'+
            '<input type="text" placeholder="Area of Effect"></td>'+
            '<td class="aoe-close">X</td></tr>').prependTo('#area-effects')
    }
    if (!effecttr.is(':focus')) {
        effecttr.find('input').val(effect.text)
    }
}

function set_area(area, pageid)
{
    if (pageid != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var areadiv = $('#zoomoverlay .aoe[data-id="'+area.id+'"]')
    if (!areadiv.length) {
        areadiv = $('<div class="'+area.cls+'" style="left:'+x+'px; top:'+y+'px; width:'+w+'px; height:'+h+'px; background-color:'+area.color+';" data-color="'+area.color+'" data-id="'+area.id+'" data-page="'+pageid+'"></div>').appendTo('#zoomoverlay')
    }
    var zof = $('#zoomoverlay').offset()
    var x = area.imx * zoompos.w + zoompos.x - zof.left
    var y = area.imy * zoompos.h + zoompos.y - zof.top
    var w = area.imw * zoompos.w
    var h = area.imh * zoompos.h
    areadiv.css({left: x+'px', top: y+'px', width: w+'px', height: h+'px'})
}

function set_marker(marker, pageid)
{
    if (pageid != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var markerdiv = $('#markers .marker[data-id="'+marker.id+'"]')
    if (marker.remove) {
        markerdiv.remove()
        return
    }
    if (!markerdiv.length) {
        markerdiv = $('<div data-page="'+pageid+'" data-id="'+marker.id+
            '" data-charid="'+marker.charid+'" class="'+marker.cls+'"></div>').appendTo('#markers')
    }
    markerdiv.attr('data-label', marker.text)
    markerdiv.text(marker.text)
    markerdiv.attr('class', marker.cls)
    var x = marker.imx * zoompos.w + zoompos.x - markerdiv.width()/2
    var y = marker.imy * zoompos.h + zoompos.y - markerdiv.height()/2
    markerdiv.css({left:x+'px',top:y+'px'})
    var markerchar = $('#characters tr[data-id="'+marker.charid+'"] td.name')
    if (markerchar.length) {
        var mname = markerchar.text()
        if (marker.text.match(/^[0-9]+$/)) {
            mname = mname + ' ' + marker.text
        }
        // mname = mname + ' ' + marker.cls
        markerdiv.attr('title', mname)
    }
}

function set_icon(mapicon, pageid)
{
    if (pageid != currentpageid) { return }
    if (!$('#zoompopup').is(':visible')) { return }
    var mapicondiv = $('#markers .mapicon[data-id="'+mapicon.id+'"]')
    if (mapicon.remove) {
        mapicondiv.remove()
        return
    }
    if (!mapicondiv.length) {
        mapicondiv = $('<div title="'+mapicon.name+'" data-id="'+mapicon.id+
            '" data-name="'+mapicon.name+'" data-angle="'+mapicon.angle+
            '" data-page="'+pageid+'" data-path="'+mapicon.path+'" class="mapicon">'+
            '<img src="icons/'+mapicon.path+'"></div>').appendTo('#markers')
    }
    var x = mapicon.imx * zoompos.w + zoompos.x
    var y = mapicon.imy * zoompos.h + zoompos.y
    var iconimg = mapicondiv.find('img')
    iconimg.attr('src', 'icons/'+mapicon.path)
    iconimg.css({ transform: 'rotate('+(mapicon.angle||0)+'deg)' })
    mapicondiv.css({ left: x+'px', top: y+'px' })
    if (mapicon.locked) {
        mapicondiv.addClass('locked')
    } else {
        mapicondiv.removeClass('locked')
    }
}

function set_pagetitle(pagetitle, pageid) {
    if (pageid == currentpageid) {
        document.title = pagetitle || 'New session'
        $('#pagetitle').attr('data-page', pageid)
        $('#pagetitle').val(pagetitle||'')
        $('#pageselect option[value="'+pageid+'"]').text(pagetitle || '')
        if (!pagetitle && adminonly) {
            $('#pagetitle').focus()
        }
    }
}

function set_freeze(frozen, pageid) {
    if (pageid == currentpageid) {
        if (frozen) {
            $(document.body).addClass('frozen')
        } else {
            $(document.body).removeClass('frozen')
        }
    }
}

function show_page(page)
{
    $('#fileupload tr.mapupload:not(.mapuploadnew)').remove()
    set_pagetitle(page.title || '', page.id)
    set_freeze(page.frozen, page.id)
    if (page.zoom) {
        $('#selector').hide()
        $('#zoompopup').hide()
        $('#markers').html('')
        $('#zoomoverlay div.aoe').remove()
        $('#area-effects tr.aoe').remove()
        set_zoom(page.zoom)
    } else {
        hide_zoom()
    }
    if (page.markers) {
        for (mr in page.markers) {
            set_marker(page.markers[mr], page.id)
        }
    }
    if (page.icons) {
        for (mr in page.icons) {
            set_icon(page.icons[mr], page.id)
        }
    }
    if (page.areas) {
        for (ar in page.areas) {
            set_area(page.areas[ar], page.id)
        }
    }
    if (page.effects) {
        for (ar in page.effects) {
            set_effect(page.effects[ar], page.id)
        }
    }
    set_initiative(page.initiative, page.id)
    var playerlink = window.location.origin+'#'+page.token
    if (page.token) {
        $('#playerlink a').text(playerlink)
        $('#playerlink a').attr('href', playerlink)
    } else {
        $('#playerlink a').text('')
        $('#playerlink a').attr('href', '')
    }
    if (page.map) {
        set_map(page.map, page.id)
    } else {
        $('#map img').attr('src', 'Welcome.png')
    }
}

function set_map(map, pageid)
{
    $('#fileupload tr[data-page="'+pageid+'"][data-name="'+map.name+'"] input.active').prop('checked', true), ('#fileupload tr[data-page="'+pageid+'"][data-name="'+map.name+'"] input.active')
    if (pageid == currentpageid) {
        $('#map img').attr('src', 'maps/'+map.path)
    }
}

function load() {
    $(window).on('hashchange', function(e) {
        socket.close()
        currentpageid = null
        $('#pagetitle').attr('placeholder', 'Select session')
        $('.editonly').hide()
        show_page({})
        socket.open()
    })
    $('#map img').on('mousedown', select_map)
    $('#zoomclose').click(hide_zoom)
    $('#zoomclear').click(clear_zoom)
    $('#zoomoverlay').on('mousedown', select_aoe)
    $('#characters').on('mousedown', function(e) { if (e.which == 1) return false })
    $('#characters').on('mousedown', 'tr', start_marker)
    $('#markers').on('mousedown', '.marker', drag_marker)

    $('#mapicons').on('mousedown', function(e) { if (e.which == 1) return false })
    $('#mapicons').on('mousedown', '.mapicon', start_mapicon)
    $('#markers').on('mousedown', '.mapicon', drag_mapicon)
    $('#removemapicon').on('mousedown', drag_removeicon)

    set_aoe_styles()
    $('td.area-effects').on('click','div', add_aoe)
    $('#area-effects').on('click','tr.aoe td.aoe-close', close_aoe)
    $('#area-effects').on('input','input', oninput_effect)
    $('#area-effects').on('change','input', emit_effect)

    $('#characters').on('mousedown', 'input,select', function(e) { e.stopPropagation() })
    $('#characters').on('keyup','input', check_updown)
    $('#characters').on('input','input.initiative', check_ordering)
    $('#characters').on('input','td.newrow input,td.newrow select', add_character_row)
    $('#characters').on('input','td.chartype input,td.chartype select', set_character_class)
    $('#pagetitle').on('change', set_page_title)
    $('#pageselect').on('change', select_page)

    $('#fileupload input.mapnamenew').val('')

    var stylecss = $('link[href="style.css"]')
    if (stylecss.length) {
        try {
            var rules = stylecss[0].sheet.cssRules
            var classarray = []
            for (var i = 0; i < rules.length; i++) {
                var rule = rules[i]
                var m = rule.selectorText.match(/^option\.([A-Za-z0-9_-]+),.*#markers/)
                if (m) {
                    classarray.push('<option class="'+m[1]+'" value="'+m[1]+'">'+m[1]+'</option>')
                }
            }
            if (classarray.length > 0) {
                classarray.push('<option class="deleteme" value="">Delete</option>')
                charclasslist = classarray.join('')
            }
        } catch (e) {
            console.log('scan stylesheet for classes exception', e)
        }
    }
}

function hide_marker_menu(e)
{
    $(this).remove()
}

function send_marker_menu(e)
{
    var elem = $(this)
    var menu = elem.closest('.markermenu')
    var action = elem.attr('data-action')
    var pageid = menu.attr('data-page')
    var markerid = menu.attr('data-id')
    var marker = $('#markers .marker[data-page="'+pageid+'"][data-id="'+markerid+'"]')
    if (marker.length) {
        var cls = marker.attr('class').replace(/(^| )dead( |$)/g, ' ').replace(/  */g,' ').trim()
        if (action == 'remove') {
            cls += ' removed'
        } else if (action == 'kill') {
            cls += ' dead'
        }
        socket.emit('marker', { id: markerid, cls: cls }, pageid)
    }
    menu.remove()
}

function show_marker_menu(e)
{
    if (adminonly) {
        var elem = $(this)
        var txt = elem.attr('data-label')
        var charid = elem.attr('data-charid')
        if (!charid) return
        var chartr = $('#characters tr[data-id="'+charid+'"]')
        var charname = chartr.find('.name').text()
        if (txt.match(/^[0-9]+$/)) { charname += ' '+txt }
        var dead = elem.hasClass('dead')
        var marker_menu = $('<div class="contextmenu markermenu" '+
            'data-id="'+elem.attr('data-id')+'" data-page="'+elem.attr('data-page')+'">'+
            '<div class="menuheader">'+charname+'</div>'+
            (dead ? '<div class="menuitem revivemarker" data-action="revive">Alive</div>'
                  : '<div class="menuitem killmarker" data-action="kill">Dead</div>')+
            '<div class="menuitem removemarker" data-action="remove">Remove</div>'+
            '</div>').appendTo('#markers')
        marker_menu.mouseleave(hide_marker_menu)
        var x = e.pageX - 10
        var y = e.pageY - 10
        marker_menu.css({position: 'fixed', left: x+'px', top: y+'px'})
        return false
    }
}

function show_mapicon_menu(e)
{
    if (adminonly) {
        var elem = $(this).closest('.mapicon')
        var menu = $('<div class="contextmenu mapiconmenu" '+
            'data-id="'+elem.attr('data-id')+'" data-page="'+elem.attr('data-page')+'">'+
            '<div class="menuheader">'+elem.attr('data-name')+'</div>'+
            '<div class="menuitem rotateicon" data-action="rotate">Rotate</div>'+
            (elem.hasClass('locked') ? 
                '<div class="menuitem unlockicon" data-action="unlock">Unlock</div>' :
                '<div class="menuitem lockicon" data-action="lock">Lock</div>' )+
            '<div class="menuitem removeicon" data-action="remove">Remove</div>'+
            '</div>').appendTo('#markers')
        menu.mouseleave(hide_marker_menu)
        var x = e.pageX - 10
        var y = e.pageY - 10
        menu.css({position: 'fixed', left: x+'px', top: y+'px'})
        return false
    }
}

function drag_removeicon(e)
{
    if (e.which != 1) return
    $('#dragremoveicon').remove()
    var removeicon = $('<div id="dragremoveicon" class="tile">Re Move</div>').appendTo('#mapicons')
    removeicon.css({left:e.pageX+'px',top:e.pageY+'px'})
    $('#mapicons .mapicon').on('mouseenter', function(e) {
        $(this).addClass('removing')
    }).on('mouseleave', function(e) {
        $(this).removeClass('removing')
    })
    $(window).on('mousemove', function(e) {
        removeicon.css({left:e.pageX+'px',top:e.pageY+'px'})
        return false
    }).on('mouseup', function(e) {
        $(window).off('mousemove').off('mouseup')
        $('#mapicons .mapicon').off('mouseenter').off('mouseleave')
        var toremove = $('#mapicons .mapicon.removing')
        if (toremove.length) {
            socket.emit('iconremove', { name: toremove.attr('data-name') })
        }
        removeicon.remove()
        return false
    })

    return false
}

function send_icon_remove(e)
{
    var elem = $(this)
    socket.emit('iconremove', { name: elem.attr('data-name') })
}

function send_mapicon_menu(e)
{
    var elem = $(this)
    var menu = elem.closest('.mapiconmenu')
    var action = elem.attr('data-action')
    var pageid = menu.attr('data-page')
    var mapiconid = menu.attr('data-id')
    var mapicon = $('#markers .mapicon[data-page="'+pageid+'"][data-id="'+mapiconid+'"]')
    if (mapicon.length) {
        if (action == 'remove') {
            socket.emit('icon', { id: mapiconid, remove: true }, pageid)
        }
        if (action == 'lock') {
            socket.emit('icon', { id: mapiconid, locked: true }, pageid)
        }
        if (action == 'unlock') {
            socket.emit('icon', { id: mapiconid, locked: false }, pageid)
        }
    }
    menu.remove()
}

function rotate_mapicon(e)
{
    if (e.which != 1) return
    var menu = $(this).closest('.mapiconmenu')
    var mapicon = $('#markers .mapicon[data-page="'+menu.attr('data-page')+'"][data-id="'+menu.attr('data-id')+'"]')
    var iconimg = mapicon.find('img')
    var currentX = e.pageX
    var curangle = parseInt(mapicon.attr('data-angle')) || 0
    $(window).on('mousemove', function(e) {
        var ang = Math.round(((e.pageX - currentX) / 3 + curangle) % 360)
        if (ang < 0) { ang = ang + 360 }
        iconimg.css({ transform: 'rotate('+ang+'deg)'})
    }).on('mouseup', function(e) {
        var ang = Math.round(((e.pageX - currentX) / 3 + curangle) % 360)
        if (ang < 0) { ang = ang + 360 }
        iconimg.css({ transform: 'rotate('+ang+'deg)'})
        if (ang != curangle) {
            mapicon.attr('data-angle', ang)
            socket.emit('icon', {
                id:     mapicon.attr('data-id'),
                angle:  ang
            }, mapicon.attr('data-page'))
        }
        $(window).off('mousemove').off('mouseup')
        return false
    })
    menu.remove()
    return false
}

function select_page(e)
{
    var pageid = $(this).val()
    if (pageid == 'new') {
        socket.emit('createpage', get_uid())
    } else {
        socket.emit('selectpage', pageid)
    }
}

function set_page_title(e)
{
    socket.emit('pagetitle', $(this).val(), currentpageid)
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
    socket.emit('mapremove', { name: tr.attr('data-name') }, tr.attr('data-page'))
}

function select_mapfile(e)
{
    var tr = $(this).closest('tr')
    socket.emit('map', { name: tr.attr('data-name') }, tr.attr('data-page'))
}

function new_maprow(e)
{
    if ($(this).val()) {
        var tr = $(this).closest('tr')
        tr.append('<td><label><div class="upload button">browse</div>'+
            '<input name="mapimage" type="file" class="uploadfile" value="Map" '+
            'accept=".jpeg,.jpg,.png,.gif,image/*"></label></td>')
        $(this).removeClass('mapnamenew').addClass('mapname')
        tr.removeClass('mapuploadnew')
        $(this).closest('tbody').append('<tr class="mapupload mapuploadnew">'+
            '<td><input class="active" type="radio" name="mapactive"></td>'+
            '<td class="mapname"><input class="mapnamenew" type="text" placeholder="New Map Name"></td>'+
            '</tr>')
        tr.attr('data-name', $(this).val())
    }
}

function add_mapfile(map, pageid)
{
    if (pageid != currentpageid) { return }
    if (adminonly) {
        var mapfileent = $('#fileupload tr.mapupload[data-page="'+pageid+'"][data-name="'+map.name+'"]')
        if (!mapfileent.length) {
            mapfileent = $('<tr class="mapupload" data-name="'+map.name+'" data-page="'+pageid+'">'+
                              '<td><input class="active" type="radio" name="mapactive" '+(map.active?'checked':'')+'></td>'+
                              '<td class="mapname">'+map.name+'</td>'+
                              '<td><label><div class="upload button">browse</div>'+
                              '<input name="mapimage" type="file" class="uploadfile" value="Map" '+
                              'accept=".jpg,.png,.gif,image/*"></label></td>'+
                              '<td class="removemap"><div class="remove button">X</div></td>'+
                           '</tr>').insertBefore('#fileupload tr.mapuploadnew')
        }
    }
    if (map.name.match(/^[A-Za-z0-9_-]+$/)) {
        $('.backgroundimage-'+map.name).css({'background-image': 'url("maps/'+map.path+'")'})
    }
}

function add_iconfile(icon)
{
    if (adminonly) {
        var iconfileent = $('#mapicons .mapicon[data-name="'+icon.name+'"]')
        if (!iconfileent.length) {
            iconfileent = $('<div class="tile mapicon" data-name="'+icon.name+
                '" data-path="'+icon.path+'" title="'+icon.name+'">'+
                '<img src="icons/'+icon.path+'"></div>').insertBefore('#newmapicon')
        }
    }
}

function remove_mapfile(map, pageid)
{
    if (pageid != currentpageid) { return }
    $('#fileupload tr.mapupload[data-page="'+pageid+'"][data-name="'+map.name+'"]').remove()
}

function remove_iconfile(icon)
{
    $('#mapicons .mapicon[data-name="'+icon.name+'"]').remove()
}

var uploads = {}

function upload_map_data(datareq, pageid)
{
    var upl = uploads[pageid+'/'+datareq.id]
    if (!upl) {
        console.log('Error: Requested unkown map data', datareq, pageid)
        return
    }
    var endpos = datareq.pos + (100*1024)
    var filetr = $('#fileupload tr.mapupload[data-page="'+pageid+'"][data-name="'+datareq.name+'"]')
    if (endpos >= upl.file.size) {
        var active = filetr.find('input.active').is(':checked')
        upl.reader.onload = function(e) {
            var data = e.target.result
            socket.emit('mapuploaddata', {
                id: datareq.id,
                name: datareq.name,
                fileext: datareq.fileext,
                data: data,
                pos: datareq.pos,
                active: active,
                finished: true
            }, pageid)
            filetr.removeClass('uploading')
            filetr.find('div.upload.button').text('browse')
        }
        upl.reader.readAsArrayBuffer(upl.file.slice(datareq.pos))
    } else {
        upl.reader.onload = function(e) {
            var data = e.target.result
            socket.emit('mapuploaddata', {
                id: datareq.id,
                name: datareq.name,
                fileext: datareq.fileext,
                data: data,
                pos: datareq.pos,
                finished: false
            }, pageid)
        }
        var perc = Math.round(100*(datareq.pos / upl.file.size))
        filetr.find('div.upload.button').text(perc+'%')
        upl.reader.readAsArrayBuffer(upl.file.slice(datareq.pos, endpos))
    }
}

function upload_map(e)
{
    var fileinp = $(this)
    var filetr = fileinp.closest('tr')
    var file = this.files[0]
    if (file.size > 10000000) {
        alert('File '+file.name+' too big: '+file.size)
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
    var fileext = file.name.replace(/.*\./,'')
    var reader = new FileReader()
    filetr.removeClass('failed').addClass('uploading')
    var map_id = get_uid()
    uploads[filepage+'/'+map_id] = {
        reader: reader,
        file: file
    }
    socket.emit('mapupload', { id: map_id, name: filename, filesize: file.size, fileext: fileext }, filepage)
}

function upload_icon_data(datareq)
{
    var upl = uploads[datareq.id]
    if (!upl) {
        console.log('Error: Requested unkown icon data', datareq)
        return
    }
    var endpos = datareq.pos + (100*1024)
    var iconupl = $('#newmapicon')
    if (endpos >= upl.file.size) {
        upl.reader.onload = function(e) {
            var data = e.target.result
            socket.emit('iconuploaddata', {
                id: datareq.id,
                name: datareq.name,
                fileext: datareq.fileext,
                data: data,
                pos: datareq.pos,
                finished: true
            } )
            iconupl.removeClass('uploading')
            iconupl.find('div.upload.button').text('Up load')
        }
        upl.reader.readAsArrayBuffer(upl.file.slice(datareq.pos))
    } else {
        upl.reader.onload = function(e) {
            var data = e.target.result
            socket.emit('iconuploaddata', {
                id: datareq.id,
                name: datareq.name,
                fileext: datareq.fileext,
                data: data,
                pos: datareq.pos,
                finished: false
            })
        }
        var perc = Math.round(100*(datareq.pos / upl.file.size))
        iconupl.find('div.upload.button').text(perc+'%')
        upl.reader.readAsArrayBuffer(upl.file.slice(datareq.pos, endpos))
    }
}

function upload_icon(e)
{
    var fileinp = $(this)
    var iconupl = $('#newmapicon')
    var file = this.files[0]
    if (file.size > 1000000) {
        alert('File '+file.name+' too big: '+file.size)
        iconupl.addClass('failed')
        return
    }
    var filename = file.name.replace(/\..*$/, '')
    var fileext  = file.name.replace(/^.*\./,'')
    var reader = new FileReader()
    iconupl.removeClass('failed').addClass('uploading')
    var icon_id = get_uid()
    uploads[icon_id] = {
        reader: reader,
        file: file
    }
    socket.emit('iconupload', { id: icon_id, name: filename, filesize: file.size, fileext: fileext })
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
        color:  aoe.attr('data-color'),
        text:   aoe.find('input').val(),
        player: true
    }, aoe.attr('data-page'))
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
        color: aoe.attr('data-color'),
        text:  inp.val(),
        player: true
    }, aoe.attr('data-page'))
}

function close_aoe()
{
    var tr = $(this).parent('tr')
    socket.emit('removeeffect', { id: tr.attr('data-id') }, tr.attr('data-page'))
}

function remove_area(area, pageid)
{
    if (pageid != currentpageid) { return }
    $('#zoomoverlay .aoe[data-id="'+area.id+'"]').remove()
}

function remove_effect(effect, pageid)
{
    if (pageid != currentpageid) { return }
    var effecttr = $('#area-effects .aoe[data-id="'+effect.id+'"]')
    effecttr.remove()
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
        cls:   aoe.attr('class'),
        imx:   imx,
        imy:   imy,
        imw:   imw,
        imh:   imh,
        color: aoe.attr('data-color'),
        player: true
    }, aoe.attr('data-page'))
}

function start_marker(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var ch = $(this)
    var mid = ch.find('td.name').text().trim()
    var cls = ['marker']
    var charid = ch.attr('data-id')

    mid = mid[0]
    if (mid) {
        var markerid = get_uid()
        var marker = $('#markers div[data-charid="'+charid+'"]')
        if (marker.length) {
            if (ch.hasClass('pc')) {
                markerid = marker.attr('data-id')
                marker.remove()
            }
        }
        cls.push(ch.attr('class'))
        marker = $('<div data-page="'+currentpageid+'" data-charid="'+charid+'" data-label="'+mid+
            '" data-id="'+markerid+'" class="'+cls.join(' ')+'">'+mid+'</div>').appendTo('#markers')
        drag_marker.apply(marker, [e])
    }
    return false
}

function start_mapicon(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var icon = $(this)
    var path = icon.attr('data-path')

    var iconid = get_uid()
    var mapicon = $('<div title="'+icon.attr('data-name')+'" data-id="'+iconid+
        '" data-name="'+icon.attr('data-name')+'" data-angle="0"'+
        'data-page="'+currentpageid+'" data-path="'+path+'" class="mapicon">'+
        '<img src="icons/'+path+'"></div>').appendTo('#markers')
    drag_mapicon.apply(mapicon, [e])

    return false
}

var nextmovesend = 0

function drag_marker(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var marker = $(this)
    var currentX = e.pageX
    var currentY = e.pageY
    marker.addClass('dragging')
    $(window).on('mousemove', function(e) {
        if ((e.pageX == currentX) && (e.pageY == currentY)) { return }
        currentX = undefined
        var x = (e.pageX-marker.width()/2)
        var y = (e.pageY-marker.height()/2)
        marker.css({left:x+'px',top:y+'px'})

        var imx = (e.pageX - zoompos.x)/zoompos.w
        var imy = (e.pageY - zoompos.y)/zoompos.h
        var now = new Date().getTime()
        if (nextmovesend < now) {
            socket.emit('marker', {
                id:     marker.attr('data-id'),
                charid: marker.attr('data-charid'),
                imx:    imx,
                imy:    imy,
                text:   marker.attr('data-label'),
                player: true, // false to disable plebs to move them
                cls:    marker.attr('class')
            }, marker.attr('data-page'))
            nextmovesend = now + 200
        }
        return false
    }).on('mouseup', function(e) {
        marker.removeClass('dragging')
        if ((e.pageX != currentX) || (e.pageY != currentY)) {
            var x = (e.pageX-marker.width()/2)
            var y = (e.pageY-marker.height()/2)
            marker.css({left:x+'px',top:y+'px'})
            var imx = (e.pageX - zoompos.x)/zoompos.w
            var imy = (e.pageY - zoompos.y)/zoompos.h
            socket.emit('marker', {
                id:     marker.attr('data-id'),
                imx:    imx,
                imy:    imy,
                text:   marker.attr('data-label'),
                player: marker.hasClass('pc'),
                cls:    marker.attr('class')
            }, marker.attr('data-page'))
        }
        $(window).off('mousemove').off('mouseup')
        return false
    })
    return false
}

function drag_mapicon(e)
{
    if (e.which != 1) return
    if (!$('#zoompopup').is(':visible')) return false
    var mapicon = $(this)
    if (mapicon.hasClass('locked')) return
    var currentX = e.pageX
    var currentY = e.pageY
    mapicon.addClass('dragging')
    $(window).on('mousemove', function(e) {
        if ((e.pageX == currentX) && (e.pageY == currentY)) { return }
        currentX = undefined
        var x = e.pageX
        var y = e.pageY
        mapicon.css({left:x+'px',top:y+'px'})
        return false
    }).on('mouseup', function(e) {
        if ((e.pageX != currentX) || (e.pageY != currentY)) {
            var x = e.pageX
            var y = e.pageY
            mapicon.css({left:x+'px',top:y+'px'})
            var imx = (e.pageX - zoompos.x)/zoompos.w
            var imy = (e.pageY - zoompos.y)/zoompos.h
            socket.emit('icon', {
                    id:     mapicon.attr('data-id'),
                    path:   mapicon.attr('data-path'),
                    name:   mapicon.attr('data-name'),
                    angle:  parseInt(mapicon.attr('data-angle')) || 0,
                    imx:    imx,
                    imy:    imy
            }, mapicon.attr('data-page'))
        }
        mapicon.removeClass('dragging')
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
    return { x: x1, y: y1, w: w, h: h }
}

function size_map(e) {
    // Related to '#map' because that's where the zoombox overlay is
    var sp = selector_pos(e, $('#map'))
    $('#selector').show().css({left:sp.x+'px',top:sp.y+'px',width:sp.w+'px',height:sp.h+'px'})
    return false
}

function show_zoom(e) {
    // Related to '#map img' because that's the image itself
    $(this).off('mousemove').off('mouseup')
    var zoom = selector_pos(e, $('#map img'))
    var img = $('#map img')
    zoom.src = img.attr('src')
    zoom.imw = img.width()
    zoom.imh = img.height()
    socket.emit('zoom', zoom, currentpageid)
    set_zoom(zoom)
}

function set_zoom(sp)
{
    if (!sp || sp.w < 20 || sp.h < 20) {
        return hide_zoom()
    }
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
    $('#zoom').css({width: zoomw+'px', height: zoomh+'px', left: zoomx+'px', top: zoomy+'px'})
    $('#zoom').html('<img src="'+sp.src+'">')
    $('#zoomoverlay').css({width: zoomw+'px', height: zoomh+'px', left: zoomx+'px', top: zoomy+'px'})
    $('#zoomclose').css({left: (zoomx+zoomw)+'px', top: zoomy+'px'})
    $('#zoomclear').css({left: (zoomx+zoomw)+'px', top: (zoomy+zoomh-40)+'px'})
    var iw = sp.imw * scale
    var ih = sp.imh * scale
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
    socket.emit('getmarkers', currentpageid)
    return false
}

function clear_zoom()
{
    if (confirm('Clear zoom map?')) {
        socket.emit('clearzoom', currentpageid)
    }
}

function hide_zoom()
{
    if ($('#zoompopup').is(':visible')) {
        $('#selector').hide()
        $('#zoompopup').hide()
        $('#markers').html('')
        $('#zoomoverlay div.aoe').remove()
        $('#area-effects tr.aoe').remove()
        socket.emit('zoom', { x: 0, y: 0, w: 0, h: 0 }, currentpageid)
    }
}
