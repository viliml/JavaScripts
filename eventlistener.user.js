// ==UserScript==
// @name         EventListener
// @namespace    https://github.com/BrokenEagle/JavaScripts
// @version      11.0
// @source       https://danbooru.donmai.us/users/23799
// @description  Informs users of new events (flags,appeals,dmails,comments,forums,notes)
// @author       BrokenEagle
// @match        *://*.donmai.us/*
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/BrokenEagle/JavaScripts/stable/eventlistener.user.js
// @require      https://raw.githubusercontent.com/jquery/jquery-ui/1.12.1/ui/widgets/tabs.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/debug.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/load.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/utility.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/validate.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/storage.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180827/lib/danbooru.js
// ==/UserScript==

/****Global variables****/

//Variables for debug.js
JSPLib.debug.debug_console = false;
JSPLib.debug.level = JSPLib.debug.INFO;
JSPLib.debug.pretext = "EL:";
JSPLib.debug.pretimer = "EL-";

//Variables for load.js
const program_load_required_variables = ['window.jQuery','window.Danbooru'];
const program_load_required_selectors = ["#nav","#page"];

//The max number of items to grab with each network call
const query_limit = 100;

//Various program expirations
const recheck_event_expires = 5 * JSPLib.utility.one_minute;
const process_semaphore_expires = 5 * JSPLib.utility.one_minute;

//For factory reset
const localstorage_keys = [
    'el-process-semaphore','el-events', 'el-timeout',
    'el-commentlist', 'el-commentlastid',
    'el-savedcommentlist', 'el-savedcommentlastid',
    'el-notelist', 'el-notelastid',
    'el-savednotelist', 'el-savednotelastid',
    'el-commentarylist', 'el-commentarylastid',
    'el-forumlist', 'el-forumlastid',
    'el-dmaillastid',
    'el-spamlastid',
    'el-flaglastid',
    'el-appeallastid'
];
//Not handling reset event yet
const program_reset_keys = {};

//Type configurations
const typedict = {
    flag: {
        controller: 'post_flags',
        addons: {},
        useraddons: function (username) {return {search: {category: 'normal',post_tags_match: "user:" + username}};},
        filter: (array)=>{return array.filter((val)=>{return IsShownData(val,[],'creator_id',null);})},
        insert: InsertEvents
    },
    appeal: {
        controller: 'post_appeals',
        addons: {},
        useraddons: function (username) {return {search: {post_tags_match: "user:" + username}};},
        filter: (array)=>{return array.filter((val)=>{return IsShownData(val,[],'creator_id',null);})},
        insert: InsertEvents
    },
    dmail: {
        controller: 'dmails',
        addons: {search: {is_spam: false}},
        useraddons: function (username) {return {};},
        filter: (array)=>{return array.filter((val)=>{return IsShownData(val,[],'from_id',null,(val)=>{return !val.is_read});})},
        insert: InsertDmails
    },
    spam: {
        controller: 'dmails',
        addons: {search: {is_spam: true}},
        useraddons: function (username) {return {};},
        filter: (array)=>{return array.filter((val)=>{return IsShownData(val,[],'from_id',null,(val)=>{return !val.is_read});})},
        insert: InsertDmails
    },
    comment: {
        controller: 'comments',
        addons: {group_by: 'comment'},
        filter: (array,typelist)=>{return array.filter((val)=>{return IsShownData(val,typelist,'creator_id','post_id');})},
        insert: InsertComments
    },
    forum: {
        controller: 'forum_posts',
        addons: {},
        filter: (array,typelist)=>{return array.filter((val)=>{return IsShownData(val,typelist,'creator_id','topic_id');})},
        insert: InsertForums
    },
    note: {
        controller: 'note_versions',
        addons: {},
        filter: (array,typelist)=>{return array.filter((val)=>{return IsShownData(val,typelist,'updater_id','post_id');})},
        insert: InsertNotes
    },
    commentary: {
        controller: 'artist_commentary_versions',
        addons: {},
        filter: (array,typelist)=>{return array.filter((val)=>{return IsShownData(val,typelist,'updater_id','post_id',IsShownCommentary);})},
        insert: InsertEvents
    }
};

function IsShownData(val,typelist,user_key=null,subscribe_key=null,other_filters=null) {
    if (Danbooru.EL.user_settings.filter_user_events && user_key && val[user_key] === Danbooru.EL.userid) {
        return false;
    }
    if (subscribe_key && !typelist.includes(val[subscribe_key])) {
        return false;
    }
    if (other_filters && !other_filters(val)) {
        return false;
    }
    return true;
}

function IsShownCommentary(val) {
    if (!Danbooru.EL.user_settings.filter_untranslated_commentary) {
        return true;
    }
    return (Boolean(val.translated_title) || Boolean(val.translated_description));
}

function GetRecheckExpires() {
    return Danbooru.EL.user_settings.recheck_interval * JSPLib.utility.one_minute;
}

//HTML for the notice block
const notice_box = `
<div id="event-notice" style="display:none">
    <div id="dmail-section"  style="display:none">
        <h1>You've got mail!</h1>
        <div id="dmail-table"></div>
    </div>
    <div id="flag-section"  style="display:none">
        <h1>You've got flags!</h1>
        <div id="flag-table"></div>
    </div>
    <div id="appeal-section"  style="display:none">
        <h1>You've got appeals!</h1>
        <div id="appeal-table"></div>
    </div>
    <div id="forum-section"  style="display:none">
        <h1>You've got forums!</h1>
        <div id="forum-table"></div>
    </div>
    <div id="comment-section"  class="comments-for-post" style="display:none">
        <h1>You've got comments!</h1>
        <div id="comment-table"></div>
    </div>
    <div id="note-section"  style="display:none">
        <h1>You've got notes!</h1>
        <div id="note-table"></div>
    </div>
    <div id="commentary-section"  style="display:none">
        <h1>You've got commentaries!</h1>
        <div id="commentary-table"></div>
    </div>
    <div id="spam-section"  style="display:none">
        <h1>You've got spam!</h1>
        <div id="spam-table"></div>
    </div>
    <p><a href="#" id="hide-event-notice">Close this</a> [<a href="#" id="lock-event-notice">LOCK</a>]</p>
</div>
`;

//Program CSS
const eventlistener_css = `
#event-notice {
    background: #fdf5d9;
    border: 1px solid #fceec1;
}
#c-comments #a-index #p-index-by-post .subscribe-comment,
#c-comments #a-index #p-index-by-post .unsubscribe-comment {
    margin: 1em 0;
}
#c-comments #a-index #p-index-by-comment table,
#event-notice #comments-section #comment-table table {
    float: left;
    text-align: center;
}
#c-comments #a-index #p-index-by-comment .preview,
#event-notice #comments-section #comments-table .preview {
    margin-right: 0;
}
.striped .subscribe-forum,
.striped .unsubscribe-forum,
.striped .subscribe-note,
.striped .unsubscribe-note,
#event-notice .show-full-forum,
#event-notice .hide-full-forum,
#event-notice .show-full-dmail,
#event-notice .hide-full-dmail,
#event-notice .show-full-note,
#event-notice .hide-full-note {
    font-family: monospace;
}
#nav #el-subscribe-events {
    padding-left: 2em;
    font-weight: bold;
}
#el-subscribe-events #el-add-links li {
    margin: 0 -6px;
}
#el-subscribe-events .el-subscribed a,
#el-subscribe-events a[href$="/unsubscribe"] {
    color: green;
}
#el-subscribe-events .el-unsubscribed a,
#el-subscribe-events a[href$="/subscribe"] {
    color: darkorange;
}
#lock-event-notice {
    font-weight: bold;
    color: green;
}
#lock-event-notice.el-locked {
    color: red;
}
`;

//Fix for showing comments
const comment_css = `
#event-notice #comment-section #comment-table .preview {
    float: left;
    width: 154px;
    height: 154px;
    margin-right: 30px;
    overflow: hidden;
    text-align; center;
}
#event-notice #comment-section #comment-table .comment {
    margin-left: 184px;
    margin-bottom: 2em;
    word-wrap: break-word;
    padding: 5px;
    display: block;
}
`;

//Fix for showing forum posts
const forum_css = `
#event-notice #forum-section #forum-table .author {
    padding: 1em 1em 0 1em;
    width: 12em;
    float: left;
}
#event-notice #forum-section #forum-table .content {
    padding: 1em;
    margin-left: 14em;
}`;

/****Functions****/

//Library functions

function CheckSemaphore() {
    let semaphore = JSPLib.storage.getStorageData('el-process-semaphore',localStorage,0);
    return !JSPLib.validate.validateExpires(semaphore, process_semaphore_expires);
}

function FreeSemaphore() {
    $(window).off('beforeunload.el.semaphore');
    JSPLib.storage.setStorageData('el-process-semaphore',0,localStorage);
}

function ReserveSemaphore() {
    if (CheckSemaphore()) {
        //Guarantee that leaving/closing tab reverts the semaphore
        $(window).on('beforeunload.el.semaphore',function () {
            JSPLib.storage.setStorageData('el-process-semaphore',0,localStorage);
        });
        //Set semaphore with an expires in case the program crashes
        let semaphore = JSPLib.utility.getExpiration(process_semaphore_expires);
        JSPLib.storage.setStorageData('el-process-semaphore', semaphore, localStorage);
        return semaphore;
    }
    return null;
}

function IsNamespaceBound(selector,eventtype,namespace) {
    let namespaces = GetBoundEventNames(selector,eventtype);
    return namespaces.includes(namespace);
}

function GetBoundEventNames(selector,eventtype) {
    let $obj = $(selector);
    if ($obj.length === 0) {
        return [];
    }
    let boundevents = $._data($obj[0], "events");
    if (!boundevents || !(eventtype in boundevents)) {
        return [];
    }
    return $.map(boundevents[eventtype],(entry)=>{return entry.namespace;});
}

function AddStyleSheet(url,title='') {
    AddStyleSheet.cssstyle = AddStyleSheet.cssstyle || {};
    if (title in AddStyleSheet.cssstyle) {
        AddStyleSheet.cssstyle[title].href = url;
    } else {
        AddStyleSheet.cssstyle[title] = document.createElement('link');
        AddStyleSheet.cssstyle[title].rel = 'stylesheet';
        AddStyleSheet.cssstyle[title].type = 'text/css';
        AddStyleSheet.cssstyle[title].href = url;
        document.head.appendChild(AddStyleSheet.cssstyle[title]);
    }
}

function KebabCase(string) {
    return string.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g,'-').toLowerCase();
}

function DisplayCase(string) {
    return JSPLib.utility.titleizeString(string.toLowerCase().replace(/[_]/g,' '));
}

//Helper functions

async function SetRecentDanbooruID(type,useritem=false) {
    let jsonitem = await JSPLib.danbooru.submitRequest(typedict[type].controller,JSPLib.danbooru.joinArgs(typedict[type].addons,{limit: 1}),[]);
    if (jsonitem.length) {
        SaveLastID(type,JSPLib.danbooru.getNextPageID(jsonitem,true));
    } else if (useritem) {
        SaveLastID(type,0);
    }
}

//Data storage functions

function GetList(type) {
    if (Danbooru.EL.subscribelist[type]) {
        return Danbooru.EL.subscribelist[type];
    }
    let typelist = Danbooru.EL.subscribelist[type] = JSPLib.storage.getStorageData(`el-${type}list`,localStorage,[]);
    if (!Array.isArray(typelist) || (typelist.length && !JSPLib.validate.validateIDList(typelist))) {
        JSPLib.debug.debuglog(`Corrupted data on ${type} list!`);
        Danbooru.EL.old_subscribelist = Danbooru.EL.old_subscribelist || {};
        Danbooru.EL.old_subscribelist[type] = typelist;
        Danbooru.EL.subscribelist[type] = (Array.isArray(typelist) ? typelist.filter((id)=>{return JSPLib.validate.validateID(id);}) : []);
        JSPLib.debug.debugExecute(()=>{
            let validation_error = (Array.isArray(typelist) ? JSPLib.utility.setDifference(typelist,Danbooru.EL.subscribelist[type]) : typelist);
            JSPLib.debug.debuglog("Validation error:",validation_error);
        });
        setTimeout(()=>{JSPLib.storage.setStorageData(`el-${type}list`,Danbooru.EL.subscribelist[type],localStorage);}, 1);
    }
    return Danbooru.EL.subscribelist[type];
}

function SetList(type,input) {
    let typelist = GetList(type);
    let was_subscribed, itemid;
    if (input[0] == '-') {
        itemid = parseInt(input.slice(1));
        typelist = JSPLib.utility.setDifference(typelist,[itemid]);
        was_subscribed = true;
    } else {
        itemid = parseInt(input);
        typelist.push(itemid);
        was_subscribed = false;
    }
    Danbooru.EL.subscribelist[type] = JSPLib.utility.setUnique(typelist);
    JSPLib.storage.setStorageData(`el-${type}list`,Danbooru.EL.subscribelist[type],localStorage);
    Danbooru.EL.channel.postMessage({type: "subscribe", eventtype: type, was_subscribed: was_subscribed, itemid: itemid, eventlist: Danbooru.EL.subscribelist[type]});
}

//Quicker way to check list existence; avoids unnecessarily parsing very long lists
function CheckList(type) {
    let typelist = localStorage.getItem(`el-${type}list`);
    return typelist && typelist !== "[]";
}

function SaveLastID(type,lastid) {
    let key = `el-${type}lastid`;
    let previousid = JSPLib.storage.getStorageData(key,localStorage,0);
    lastid = Math.max(previousid,lastid);
    JSPLib.storage.setStorageData(key,lastid,localStorage);
    JSPLib.debug.debuglog(`Set last ${type} ID:`,lastid);
}

function HasEvents() {
    return JSPLib.storage.getStorageData('el-events',localStorage,false);
}

function CheckTimeout() {
    let expires = JSPLib.storage.getStorageData('el-timeout',localStorage,0);
    return !JSPLib.validate.validateExpires(expires,GetRecheckExpires());
}

function SetRecheckTimeout() {
    JSPLib.storage.setStorageData('el-timeout',JSPLib.utility.getExpiration(GetRecheckExpires()),localStorage);
}

//Return true if there are no saved events at all, or saved events for the input type
function CheckWaiting(inputtype) {
    CheckWaiting.all_waits = CheckWaiting.all_waits || {};
    if (Object.keys(CheckWaiting.all_waits).length == 0) {
        $.each(typedict,(type)=>{
            CheckWaiting.all_waits[type] = JSPLib.storage.getStorageData(`el-saved${type}lastid`,localStorage,[]).length > 0;
        });
    }
    return !(Object.values(CheckWaiting.all_waits).reduce((total,entry)=>{return total || entry;},false)) || CheckWaiting.all_waits[inputtype];
}

/****Auxiliary functions****/

function BroadcastEL(ev) {
    JSPLib.debug.debuglog("Broadcast",ev.data);
    if (ev.data.type === "hide" && !Danbooru.EL.locked_notice) {
        $("#event-notice").hide();
    } else if (ev.data.type === "settings") {
        Danbooru.EL.user_settings = ev.data.user_settings;
    } else if (ev.data.type === "reset") {
        //Not handling this yet, so just hide everything until the next page refresh
        JSPLib.utility.fullHide("#event-notice,#el-subscribe-events,.el-subscribe-dual-links");
    } else if (ev.data.type === "subscribe") {
        Danbooru.EL.subscribelist[ev.data.eventtype] = ev.data.eventlist;
        UpdateMultiLink([ev.data.eventtype],ev.data.was_subscribed,ev.data.itemid);
        UpdateDualLink(ev.data.eventtype,ev.data.was_subscribed,ev.data.itemid);
    } else if (ev.data.type === "reload") {
        Danbooru.EL.subscribelist[ev.data.eventtype] = ev.data.eventlist;
        let menuid = $("#el-subscribe-events").data('id');
        if (ev.data.was_subscribed.includes(menuid)) {
            UpdateMultiLink([ev.data.eventtype],true,menuid);
        } else if (ev.data.new_subscribed.includes(menuid)) {
            UpdateMultiLink([ev.data.eventtype],false,menuid);
        }
        $(`.subscribe-${ev.data.eventtype}[data-id]`).each((i,entry)=>{
            let linkid = $(entry).data('id');
            if (ev.data.was_subscribed.includes(linkid)) {
                UpdateDualLink(ev.data.eventtype,true,linkid);
            } else if (ev.data.new_subscribed.includes(linkid)) {
                UpdateDualLink(ev.data.eventtype,false,linkid);
            }
        });
    }
}

//Get single instance of various types and insert into table row

async function AddForumPost(forumid,$rowelement) {
    let forum_post = await $.get(`/forum_posts/${forumid}`);
    let $forum_post = $.parseHTML(forum_post);
    let $outerblock = $.parseHTML(`<tr id="full-forum-id-${forumid}"><td colspan="4"></td></tr>`);
    $("td",$outerblock).append($(".forum-post",$forum_post));
    $($rowelement).after($outerblock);
    if (Danbooru.EL.user_settings.mark_read_topics) {
        let topic_link = $("td:first-of-type > a",$rowelement);
        let topic_path = topic_link.length && topic_link[0].pathname;
        let topic_match = topic_path && topic_path.match(/^\/forum_topics\/(\d+)/);
        if (topic_match && !Danbooru.EL.marked_topic.includes(topic_match[1])) {
            ReadForumTopic(topic_match[1]);
            Danbooru.EL.marked_topic.push(topic_match[1]);
        }
    }
}

function AddRenderedNote(noteid,$rowelement) {
    let notehtml = $.parseHTML($.trim($("td:nth-of-type(4)",$rowelement)[0].innerHTML))[0].data;
    let $outerblock = $.parseHTML(`<tr id="full-note-id-${noteid}"><td colspan="7">${notehtml}</td></tr>`);
    $($rowelement).after($outerblock);
}

async function AddDmail(dmailid,$rowelement) {
    let dmail = await $.get(`/dmails/${dmailid}`);
    let $dmail = $.parseHTML(dmail);
    $(".dmail h1:first-of-type",$dmail).hide();
    let $outerblock = $.parseHTML(`<tr id="full-dmail-id-${dmailid}"><td colspan="4"></td></tr>`);
    $("td",$outerblock).append($(".dmail",$dmail));
    $($rowelement).after($outerblock);
}

//Update links

function UpdateMultiLink(typelist,subscribed,itemid) {
    let current_subscribed = JSPLib.utility.setUnique($("#el-subscribe-events .el-subscribed").map((i,entry)=>{return entry.dataset.type.split(',');}).toArray());
    let new_subscribed = (subscribed ? JSPLib.utility.setDifference(current_subscribed,typelist) : JSPLib.utility.setUnion(current_subscribed,typelist));
    $.each($(`#el-subscribe-events[data-id="${itemid}"] .el-subscribed,#el-subscribe-events[data-id="${itemid}"] .el-unsubscribed`),(i,entry)=>{
        let entry_typelist = entry.dataset.type.split(',');
        if (JSPLib.utility.setIntersection(entry_typelist,new_subscribed).length === entry_typelist.length) {
            $(entry).removeClass().addClass('el-subscribed');
        } else {
            $(entry).removeClass().addClass('el-unsubscribed');
        }
    });
}

function UpdateDualLink(type,subscribed,itemid) {
    let show = (subscribed ? 'subscribe' : 'unsubscribe');
    let hide = (subscribed ? 'unsubscribe' : 'subscribe');
    JSPLib.utility.fullHide(`.${hide}-${type}[data-id="${itemid}"]`);
    JSPLib.utility.clearHide(`.${show}-${type}[data-id="${itemid}"]`);
}

//Insert and process HTML onto page for various types

function InsertEvents($eventpage,type) {
    $(`#${type}-table`).append($(".striped",$eventpage));
    $(`#${type}-table .post-preview`).addClass("blacklisted");
}

function InsertDmails($dmailpage,type) {
    $("tr.read-false", $dmailpage).css("font-weight","bold");
    $(`#${type}-table`).append($(".striped",$dmailpage));
    let $dmails_table = $(`#${type}-table`);
    InitializeOpenDmailLinks($dmails_table);
}

function InsertComments($commentpage) {
    $(".post-preview",$commentpage).addClass("blacklisted");
    $(".edit_comment",$commentpage).hide();
    $("#comment-table").append($(".list-of-comments",$commentpage));
    InitializeCommentPartialCommentLinks("#event-notice #comments-section .post-preview");
}

function InsertForums($forumpage) {
    let $forums_table = $("#forum-table");
    $forums_table.append($(".striped",$forumpage));
    InitializeTopicIndexLinks($forums_table);
    InitializeOpenForumLinks($forums_table);
}

function InsertNotes($notepage) {
    let $notes_table = $("#note-table");
    $notes_table.append($(".striped",$notepage));
    OrderNotesTable($notes_table);
    InitializeNoteIndexLinks($notes_table);
    InitializeOpenNoteLinks($notes_table);
}

//Misc functions

function ReadForumTopic(topicid) {
    $.ajax({
        type: "HEAD",
        url:'/forum_topics/' + topicid,
        headers: {
            Accept: "text/html",
        }
    });
}

function OrderNotesTable($obj) {
    let $rows = $(".striped tr[id]",$obj);
    let sort_rows = {};
    $rows.each((i,row)=>{
        let post = $(`td:nth-of-type(2) > a:first-of-type`,row).html();
        sort_rows[post] = sort_rows[post] || [];
        sort_rows[post].push($(row).detach());
    });
    let sort_posts = Object.keys(sort_rows).sort().reverse();
    $.each(sort_posts,(i,post)=>{
        $.each(sort_rows[post],(j,row)=>{
            $(".striped tbody",$obj).append(row);
        });
        //Add a spacer for all but the last group
        if (i !== (sort_posts.length - 1)) {
            $(".striped tbody",$obj).append(`<tr><td colspan="7" style="padding:2px;background-color:#EEE"></td></tr>`);
        }
    });
}

async function GetPostsCountdown(limit,searchstring,domname) {
    let tag_addon = {tags: searchstring};
    let limit_addon = {limit: limit};
    let page_addon = {};
    var return_items = [];
    let page_num = 0;
    if (domname) {
        let total_posts = (await JSPLib.danbooru.submitRequest('counts/posts',tag_addon,{counts: {posts: 0}})).counts.posts;
        page_num = Math.ceil(total_posts/limit);
    }
    while (true) {
        if (domname) {
            JSPLib.debug.debuglog("Pages left #",page_num);
            domname && jQuery(domname).html(page_num);
        }
        let request_addons = JSPLib.danbooru.joinArgs(tag_addon,limit_addon,page_addon);
        let request_key = 'posts-' + jQuery.param(request_addons);
        let temp_items = await JSPLib.danbooru.submitRequest('posts',request_addons,[],request_key);
        return_items = return_items.concat(temp_items);
        if (temp_items.length < limit) {
            return return_items;
        }
        let lastid = JSPLib.danbooru.getNextPageID(temp_items,false);
        page_addon = {page:`b${lastid}`};
        page_num -= 1;
    }
}

/****Main execution functions****/

async function CheckUserType(type) {
    let lastidkey = `el-${type}lastid`;
    let typelastid = JSPLib.storage.getStorageData(lastidkey,localStorage,0);
    if (JSPLib.validate.validateID(typelastid)) {
        let url_addons = JSPLib.danbooru.joinArgs(typedict[type].addons,typedict[type].useraddons(Danbooru.EL.username));
        let jsontype = await JSPLib.danbooru.getAllItems(typedict[type].controller,query_limit,{addons:url_addons,page:typelastid,reverse:true});
        let filtertype = typedict[type].filter(jsontype);
        let lastusertype = (jsontype.length ? [JSPLib.danbooru.getNextPageID(jsontype,true)] : []);
        if (filtertype.length) {
            Danbooru.EL.lastids.user[type] = lastusertype[0];
            JSPLib.debug.debuglog(`Found ${type}(s)!`,Danbooru.EL.lastids.user[type]);
            let idlist = JSPLib.utility.getObjectAttributes(filtertype,'id');
            url_addons = JSPLib.danbooru.joinArgs(typedict[type].addons,{search: {id: idlist.join(',')}, limit: idlist.length});
            let typehtml = await $.get(`/${typedict[type].controller}`, url_addons);
            let $typepage = $(typehtml);
            typedict[type].insert($typepage,type);
            $("#event-notice").show();
            $(`#${type}-section`).show();
            return true;
        } else {
            JSPLib.debug.debuglog(`No ${type}(s)!`);
            if (lastusertype.length && (typelastid !== lastusertype[0])) {
                SaveLastID(type,lastusertype[0]);
            }
        }
    } else {
        SetRecentDanbooruID(type,true);
    }
    return false;
}

async function CheckSubscribeType(type) {
    let lastidkey = `el-${type}lastid`;
    let typelastid = JSPLib.storage.getStorageData(lastidkey,localStorage,0);
    if (JSPLib.validate.validateID(typelastid)) {
        let typelist = GetList(type);
        let savedlistkey = `el-saved${type}list`;
        let savedlastidkey = `el-saved${type}lastid`;
        var subscribetypelist = [], jsontypelist = [];
        let savedlastid = JSPLib.storage.getStorageData(savedlastidkey,localStorage);
        let savedlist = JSPLib.storage.getStorageData(savedlistkey,localStorage);
        if (!JSPLib.validate.validateIDList(savedlastid) || !JSPLib.validate.validateIDList(savedlist)) {
            let jsontype = await JSPLib.danbooru.getAllItems(typedict[type].controller,query_limit,{page:typelastid,addons:typedict[type].addons,reverse:true});
            let subscribetype = typedict[type].filter(jsontype,typelist);
            if (jsontype.length) {
                jsontypelist = [JSPLib.danbooru.getNextPageID(jsontype,true)];
            }
            if (subscribetype.length) {
                subscribetypelist = JSPLib.utility.getObjectAttributes(subscribetype,'id');
                JSPLib.storage.setStorageData(savedlistkey,subscribetypelist,localStorage);
                JSPLib.storage.setStorageData(savedlastidkey,jsontypelist,localStorage);
            }
        } else {
            jsontypelist = savedlastid;
            subscribetypelist = savedlist;
        }
        if (subscribetypelist.length) {
            Danbooru.EL.lastids.subscribe[type] = jsontypelist[0];
            JSPLib.debug.debuglog(`Found ${type}(s)!`,Danbooru.EL.lastids.subscribe[type]);
            let url_addons = JSPLib.danbooru.joinArgs(typedict[type].addons,{search: {id: subscribetypelist.join(',')}, limit: subscribetypelist.length});
            let typehtml = await $.get(`/${typedict[type].controller}`, url_addons);
            let $typepage = $(typehtml);
            typedict[type].insert($typepage,type);
            $("#event-notice").show();
            $(`#${type}-section`).show();
            return true;
        } else {
            JSPLib.debug.debuglog(`No ${type}(s)!`);
            if (jsontypelist.length && (typelastid !== jsontypelist[0])) {
                SaveLastID(type,jsontypelist[0]);
            }
        }
    } else {
        SetRecentDanbooruID(type);
    }
    return false;
}

async function CheckAllEvents(promise_array) {
    let hasevents_all = await Promise.all(promise_array);
    let hasevents = hasevents_all.reduce((a,b)=>{return a || b;});
    JSPLib.storage.setStorageData('el-events',hasevents,localStorage);
}

/****Render functions****/

function RenderMultilinkMenu(itemid) {
    return `
<menu id="el-subscribe-events" data-id="${itemid}">
    Subscribe (<span id="el-add-links"></span>)
</menu>`;
}

function RenderSubscribeDualLinks(type,itemid,tag,separator,ender,right=false) {
    let typelist = GetList(type);
    let subscribe = (typelist.includes(itemid) ? 'style="display:none !important"' : 'style');
    let unsubscribe = (typelist.includes(itemid) ? 'style' : 'style="display:none !important"');
    let spacer = (right ? "&nbsp;&nbsp;" : "");
    return `
<${tag} class="el-subscribe-dual-links">
    <${tag} data-id="${itemid}" class="subscribe-${type}" ${subscribe}><a href="#">${spacer}Subscribe${separator}${ender}</a></${tag}>
    <${tag} data-id="${itemid}" class="unsubscribe-${type}" ${unsubscribe}"><a href="#">Unsubscribe${separator}${ender}</a></${tag}>
</${tag}>
`;
}

function RenderSubscribeMultiLinks(name,typelist,itemid,separator) {
    let itemdict = {};
    $.each(typelist,(i,type)=>{
        itemdict[type] = GetList(type);
    });
    let classname = (typelist.reduce((total,type)=>{return total && itemdict[type].includes(itemid);},true) ? 'el-subscribed' : 'el-unsubscribed');
    let idname = 'el-' + name.toLowerCase().replace(/[ _]/g,'-') + '-link';
    return `${separator}<li id="${idname}" data-type="${typelist}" class="${classname}"><a href="#">${name}</a></li>`;
}

function RenderOpenItemLinks(type,itemid,showtext="Show",hidetext="Hide") {
    return `<span data-id="${itemid}" class="show-full-${type}" style><a href="#">${showtext}</a></span>` +
           `<span data-id="${itemid}" class="hide-full-${type}" style="display:none !important"><a href="#">${hidetext}</a></span>`;
}

/****Initialize functions****/

function InitializeNoticeBox() {
    $("#page").prepend(notice_box);
    if (Danbooru.EL.locked_notice) {
        $("#lock-event-notice").addClass("el-locked");
    }
    HideEventNoticeClick();
    LockEventNoticeClick();
}

function InitializeOpenForumLinks($obj) {
    $.each($(".striped tbody tr",$obj),(i,$row)=>{
        let forumid = $row.id.match(/(\d+)$/)[1];
        $(".forum-post-excerpt",$row).prepend(RenderOpenItemLinks('forum',forumid) + '&nbsp;|&nbsp;');
    });
    OpenItemClick('forum',$obj,3,AddForumPost);
}

function InitializeOpenNoteLinks($obj) {
    $.each($(".striped tr[id]",$obj),(i,$row)=>{
        let noteid = $("td:nth-of-type(3) a:first-of-type",$row)[0].innerHTML.replace('.','-');
        $("td:nth-of-type(4)",$row).append('<p style="text-align:center">' + RenderOpenItemLinks('note',noteid,"Render note","Hide note") + '</p>');
    });
    OpenItemClick('note',$obj,4,AddRenderedNote);
}

function InitializeOpenDmailLinks($obj) {
    $.each($(".striped tbody tr",$obj),(i,$row)=>{
        let dmailid = $row.innerHTML.match(/\/dmails\/(\d+)/)[1];
        $("td:nth-of-type(4)",$row).prepend(RenderOpenItemLinks('dmail',dmailid) + '&nbsp;|&nbsp;');
    });
    OpenItemClick('dmail',$obj,3,AddDmail);
}

//#C-POSTS #A-SHOW
function InitializePostShowMenu() {
    var postid = parseInt(JSPLib.utility.getMeta('post-id'));
    let menu_obj = $.parseHTML(RenderMultilinkMenu(postid));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("Comments",['comment'],postid,''));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("Notes",['note'],postid,' | '));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("Artist commentary",['commentary'],postid,' | '));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("Translations",['note','commentary'],postid,' | '));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("All",['comment','note','commentary'],postid,' | '));
    $("nav#nav").append(menu_obj);
    SubscribeMultiLinkClick();
}

//#C-FORUM-TOPICS #A-SHOW
function InitializeTopicShowMenu() {
    var topicid = parseInt($("#forum_post_topic_id").attr("value"));
    if (!topicid) {
        let $obj = $('a[href$="/subscribe"],a[href$="/unsubscribe"]');
        let match = $obj.attr("href").match(/\/forum_topics\/(\d+)\/(?:un)?subscribe/);
        if (!match) {
            return;
        }
        topicid = parseInt(match[1]);
    }
    let menu_obj = $.parseHTML(RenderMultilinkMenu(topicid));
    $("#el-add-links",menu_obj).append(RenderSubscribeMultiLinks("Topic",['forum'],topicid,'') + ' | ');
    $('a[href$="/subscribe"],a[href$="/unsubscribe"]').text("Email");
    let $email = $('a[href$="/subscribe"],a[href$="/unsubscribe"]').parent().detach();
    $("#el-add-links",menu_obj).append($email);
    $("nav#nav").append(menu_obj);
    SubscribeMultiLinkClick();
}

//#C-FORUM-TOPICS #A-INDEX
function InitializeTopicIndexLinks($obj) {
    $.each($(".striped tr td:first-of-type",$obj), (i,entry)=>{
        let topicid = parseInt(entry.innerHTML.match(/\/forum_topics\/(\d+)/)[1]);
        let linkhtml = RenderSubscribeDualLinks('forum',topicid,"span","","",true);
        $(entry).prepend(linkhtml + '&nbsp|&nbsp');
    });
    SubscribeDualLinkClick('forum');
}

//EVENT NOTICE
function InitializeNoteIndexLinks($obj) {
    $.each($(".striped tr[id]",$obj), (i,entry)=>{
        let postid = parseInt($("td:nth-of-type(2)",entry)[0].innerHTML.match(/\/posts\/(\d+)/)[1]);
        let linkhtml = RenderSubscribeDualLinks('note',postid,"span","","",true);
        $("td:nth-of-type(1)",entry).prepend(linkhtml);
    });
    SubscribeDualLinkClick('note');
}

//#C-COMMENTS #P-INDEX-BY-POST
function InitializeCommentPartialPostLinks() {
    $.each($("#p-index-by-post .comments-for-post"), (i,$entry)=>{
        let postid = parseInt($($entry).data('post-id'));
        let linkhtml = RenderSubscribeDualLinks('comment',postid,"div"," ","comments");
        $(".header",$entry).after(linkhtml);
    });
    SubscribeDualLinkClick('comment');
}

//#C-COMMENTS #P-INDEX-BY-COMMENT
function InitializeCommentPartialCommentLinks(selector) {
    $.each($(selector), (i,$entry)=>{
        var postid = parseInt($($entry).data('id'));
        var linkhtml = RenderSubscribeDualLinks('comment',postid,"div","<br>","comments");
        var $table = $.parseHTML(`<table><tbody><tr><td></td></tr><tr><td>${linkhtml}</td></tr></tbody></table>`);
        var $preview = $(".preview",$entry).detach();
        $("tr:nth-of-type(1) td",$table).append($preview);
        $entry.prepend($table[0]);
    });
    SubscribeDualLinkClick('comment');
}

/****Click functions****/

function HideEventNoticeClick() {
    $("#hide-event-notice").click((e)=>{
        $("#event-notice").hide();
        $.each(Danbooru.EL.lastids.user,(type,value)=>{
            SaveLastID(type,value);
        });
        $.each(Danbooru.EL.lastids.subscribe,(type,value)=>{
            SaveLastID(type,value);
            delete localStorage[`el-saved${type}list`];
            delete localStorage[`el-saved${type}lastid`];
            JSPLib.debug.debuglog(`Deleted saved values! (${type})`);
        });
        if ($("#hide-dmail-notice").length) {
            $("#hide-dmail-notice").click();
        }
        localStorage['el-events'] = false;
        Danbooru.EL.channel.postMessage({type: "hide"});
        e.preventDefault();
    });
}

function LockEventNoticeClick() {
    $("#lock-event-notice").click((e)=>{
        $(e.target).addClass("el-locked");
        Danbooru.EL.locked_notice = true;
        e.preventDefault();
    });
}

function SubscribeMultiLinkClick() {
    $("#el-subscribe-events a").off().click((e)=>{
        let $menu = $(e.target.parentElement.parentElement.parentElement);
        let $container = $(e.target.parentElement);
        let itemid = $menu.data('id');
        let typelist = $container.data('type').split(',');
        let subscribed = ($container.hasClass('el-subscribed') ? true : false);
        let prefix = (subscribed ? '-' : '');
        $.each(typelist,(i,type)=>{
            setTimeout(()=>{SetList(type,prefix + itemid);},1);
            UpdateDualLink(type,subscribed,itemid);
        });
        UpdateMultiLink(typelist,subscribed,itemid);
        e.preventDefault();
    });
}

function SubscribeDualLinkClick(type) {
    $(`.subscribe-${type} a,.unsubscribe-${type} a`).off().click((e)=>{
        let $container = $(e.target.parentElement);
        let itemid = $container.data('id');
        let subscribed = GetList(type).includes(itemid);
        let prefix = (subscribed ? '-' : '');
        setTimeout(()=>{SetList(type,prefix + itemid);},1);
        UpdateDualLink(type,subscribed,itemid);
        UpdateMultiLink([type],subscribed,itemid);
        e.preventDefault();
    });
}

function OpenItemClick(type,$obj,parentlevel,htmlfunc) {
    $(`.show-full-${type} a,.hide-full-${type} a`).off().click(function(e){
        Danbooru.EL.openlist[type] = Danbooru.EL.openlist[type] || [];
        let $container = $(e.target.parentElement);
        let itemid = $container.data('id');
        let openitem = $container.hasClass(`show-full-${type}`);
        if (openitem && !Danbooru.EL.openlist[type].includes(itemid)) {
            let rowelement = JSPLib.utility.getNthParent(e.target,parentlevel);
            htmlfunc(itemid,rowelement);
            Danbooru.EL.openlist[type].push(itemid);
        }
        let hide = (openitem ? 'show' : 'hide');
        let show = (openitem ? 'hide' : 'show');
        JSPLib.utility.fullHide(`.${hide}-full-${type}[data-id="${itemid}"]`);
        JSPLib.utility.clearHide(`.${show}-full-${type}[data-id="${itemid}"]`);
        if (openitem) {
            $(`#full-${type}-id-${itemid}`).show();
        } else {
            $(`#full-${type}-id-${itemid}`).hide();
        }
        e.preventDefault();
    });
}

function SubscribeMultiLinkCallback() {
    $.each(Danbooru.EL.user_settings.autosubscribe_enabled,(i,type)=>{
        $(`#el-subscribe-events .el-unsubscribed[data-type="${type}"] a`).click();
    });
}

///Settings menu

function RenderTextinput(program_shortcut,setting_name,length=20) {
    let program_key = program_shortcut.toUpperCase();
    let setting_key = KebabCase(setting_name);
    let display_name = DisplayCase(setting_name);
    let value = Danbooru[program_key].user_settings[setting_name];
    let hint = settings_config[setting_name].hint;
    return `
<div class="${program_shortcut}-textinput" data-setting="${setting_name}" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        <input type="text" class="${program_shortcut}-setting" name="${program_shortcut}-setting-${setting_key}" id="${program_shortcut}-setting-${setting_key}" value="${value}" size="${length}" autocomplete="off" class="text" style="padding:1px 0.5em">
        <span class="${program_shortcut}-setting-tooltip" style="display:block;font-style:italic;color:#666">${hint}</span>
    </div>
</div>`;
}

function RenderCheckbox(program_shortcut,setting_name) {
    let program_key = program_shortcut.toUpperCase();
    let setting_key = KebabCase(setting_name);
    let display_name = DisplayCase(setting_name);
    let checked = (Danbooru[program_key].user_settings[setting_name] ? "checked" : "");
    let hint = settings_config[setting_name].hint;
    return `
<div class="${program_shortcut}-checkbox" data-setting="${setting_name}" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        <input type="checkbox" ${checked} class="${program_shortcut}-setting" name="${program_shortcut}-enable-${setting_key}" id="${program_shortcut}-enable-${setting_key}">
        <span class="${program_shortcut}-setting-tooltip" style="display:inline;font-style:italic;color:#666">${hint}</span>
    </div>
</div>`;
}

function RenderInputSelectors(program_shortcut,setting_name,type) {
    let program_key = program_shortcut.toUpperCase();
    let setting_key = KebabCase(setting_name);
    let display_name = DisplayCase(setting_name);
    let all_selectors = settings_config[setting_name].allitems;
    let hint = settings_config[setting_name].hint;
    let html = '';
    $.each(all_selectors,(i,selector)=>{
        let checked = (Danbooru[program_key].user_settings[setting_name].includes(selector) ? "checked" : "");
        let display_selection = DisplayCase(selector);
        let selection_name = `${program_shortcut}-${setting_key}`;
        let selection_key = `${program_shortcut}-${setting_key}-${selector}`;
        html += `
            <label for="${selection_key}" style="width:100px">${display_selection}</label>
            <input type="${type}" ${checked} class="${program_shortcut}-setting" name="${selection_name}" id="${selection_key}" data-selector="${selector}">`;
    });
    return `
<div class="${program_shortcut}-selectors" data-setting="${setting_name}" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        ${html}
        <span class="${program_shortcut}-setting-tooltip" style="display:block;font-style:italic;color:#666">${hint}</span>
    </div>
</div>
`;
}

function RenderLinkclick(program_shortcut,display_name,link_text) {
    let setting_key = KebabCase(setting_name);
    return `
<div class="${program_shortcut}-linkclick" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        <span class="${program_shortcut}-control-linkclick" style="display:block"><a href="#" id="${program_shortcut}-setting-${setting_key}" style="color:#0073ff">${link_text}</a></span>
    </div>
</div>`;
}

function RenderTextinputControl(program_shortcut,setting_name,hint,length=20) {
    let setting_key = KebabCase(setting_name);
    let display_name = DisplayCase(setting_name);
    return `
<div class="${program_shortcut}-textinput-control" data-setting="${setting_name}" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        <input type="text" class="${program_shortcut}-control" name="${program_shortcut}-setting-${setting_key}" id="${program_shortcut}-setting-${setting_key}" size="${length}" autocomplete="off" class="text" style="padding:1px 0.5em">
        <input type="button" class="${program_shortcut}-control" name="${program_shortcut}-${setting_key}-get" id="${program_shortcut}-${setting_key}-get" value="Get">
        <span class="${program_shortcut}-setting-tooltip" style="display:block;font-style:italic;color:#666">${hint}</span>
    </div>
</div>`;
}

function RenderInputSelectorsControl(program_shortcut,setting_name,type,all_selectors,enabled_selectors,hint) {
    let setting_key = KebabCase(setting_name);
    let display_name = DisplayCase(setting_name);
    let html = '';
    $.each(all_selectors,(i,selector)=>{
        let checked = (enabled_selectors.includes(selector)  ? "checked" : "");
        let display_selection = DisplayCase(selector);
        let selection_name = `${program_shortcut}-${setting_key}`;
        let selection_key = `${program_shortcut}-${setting_key}-${selector}`;
        html += `
            <label for="${selection_key}" style="width:100px">${display_selection}</label>
            <input type="${type}" ${checked} class="${program_shortcut}-control" name="${selection_name}" id="${selection_key}" data-selector="${selector}">`;
    });
    return `
<div class="${program_shortcut}-selectors" data-setting="${setting_name}" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        ${html}
        <span class="${program_shortcut}-setting-tooltip" style="display:block;font-style:italic;color:#666">${hint}</span>
    </div>
</div>
`;
}

const usage_settings = `
<div id="el-settings" style="float:left;width:60em">
    <div id="el-script-message" class="prose">
        <h2>EventListener</h2>
        <p>Check the forum for the latest on information and updates (<a class="dtext-link dtext-id-link dtext-forum-topic-id-link" href="/forum_topics/14747" style="color:#0073ff">topic #14747</a>).</p>
    </div>
    <div id="el-notice-settings" style="margin-bottom:2em">
        <div id="el-network-message" class="prose">
            <h4>Notice settings</h4>
        </div>
    </div>
    <div id="el-event-settings" style="margin-bottom:2em">
        <div id="el-event-message" class="prose">
            <h4>Event settings</h4>
            <ul>
                <li><b>Events enabled:</b> Select which events to check for.
                    <ul>
                        <li>Subscription-type events will not be checked unless there is more than one subscribed item.</li>
                        <li>These include comments, notes, commentaries, and forums.</li>
                    </ul>
                </li>
                <li><b>Autosubscribe enabled:</b> Select which events on items created by the user will be automatically subscribed.
                    <ul>
                        <li>This will be the uploader for comments, notes and commentaries.</li>
                        <li>Events will only be subscribed on the post page for that upload.</li>
                    </ul>
                </li>
            </ul>
        </div>
    </div>
    <div id="el-network-settings" style="margin-bottom:2em">
        <div id="el-network-message" class="prose">
            <h4>Network settings</h4>
        </div>
    </div>
    <div id="el-subscribe-controls" style="margin-bottom:2em">
        <div id="el-subscribe-message" class="prose">
            <h4>Subscribe controls</h4>
            <p>Subscribe to events using search queries instead of individually.</p>
            <p><span style="color:red"><b>Warning!</b></span> Very large lists have issues:</p>
            <ul>
                <li>Higher performance delays.</li>
                <li>Could fill up the cache.</li>
                <li>Which could crash the program or other scripts.</li>
                <li>I.e. don't subscribe to <b><u>ALL</u></b> of Danbooru!</li>
            </ul>
        </div>
    </div>
    <hr>
    <div id="el-settings-buttons" style="margin-top:1em">
        <input type="button" id="el-commit" value="Save">
        <input type="button" id="el-resetall" value="Factory Reset">
    </div>
</div>`;

const enable_events = ['flag','appeal','dmail','spam','comment','note','commentary','forum'];
const autosubscribe_events = ['comment','note','commentary'];

const settings_config = {
    autolock_notices: {
        default: false,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Closing a notice will no longer close all other notices."
    },
    mark_read_topics: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Reading a forum post from the notice will mark the topic as read."
    },
    filter_user_events: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Only show events not created by the user."
    },
    filter_untranslated_commentary: {
        default: true,
        validate: (data)=>{return typeof data === "boolean";},
        hint: "Only show new commentary that has translated sections."
    },
    recheck_interval: {
        default: 5,
        parse: parseInt,
        validate: (data)=>{return Number.isInteger(data) && data > 0;},
        hint: "How often to check for new events (# of minutes)."
    },
    events_enabled: {
        allitems: enable_events,
        default: enable_events,
        validate: (data)=>{return Array.isArray(data) && data.reduce((is_string,val)=>{return is_string && (typeof val === 'string') && enable_events.includes(val);},true)},
        hint: "Uncheck to turn off event type."
    },
    autosubscribe_enabled: {
        allitems: autosubscribe_events,
        default: [],
        validate: (data)=>{return Array.isArray(data) && data.reduce((is_string,val)=>{return is_string && (typeof val === 'string') && autosubscribe_events.includes(val);},true)},
        hint: "Check to autosubscribe event type."
    }
}

function IsSettingEnabled(setting_name,selector) {
    return Danbooru.EL.user_settings[setting_name].includes(selector);
}

function LoadUserSettings(program_shortcut) {
    let user_settings = JSPLib.storage.getStorageData(`${program_shortcut}-user-settings`,localStorage,{});
    let is_dirty = false;
    $.each(settings_config,(setting)=>{
        if (!(setting in user_settings) || !settings_config[setting].validate(user_settings[setting])) {
            JSPLib.debug.debuglog("Loading default:",setting,user_settings[setting]);
            user_settings[setting] = settings_config[setting].default;
            is_dirty = true;
        }
    });
    let valid_settings = Object.keys(settings_config);
    $.each(user_settings,(setting)=>{
        if (!valid_settings.includes(setting)) {
            JSPLib.debug.debuglog("Deleting invalid setting:",setting,user_settings[setting]);
            delete user_settings[setting];
            is_dirty = true;
        }
    });
    if (is_dirty) {
        JSPLib.debug.debuglog("Saving change to user settings!");
        JSPLib.storage.setStorageData(`${program_shortcut}-user-settings`,user_settings,localStorage);
    }
    return user_settings;
}

function SaveUserSettingsClick(program_shortcut,program_name) {
    let program_key = program_shortcut.toUpperCase();
    $(`#${program_shortcut}-commit`).click((e)=>{
        let invalid_setting = false;
        let temp_selectors = {};
        $(`#${program_shortcut}-settings .${program_shortcut}-setting[id]`).each((i,entry)=>{
            let setting_name = $(entry).parent().parent().data('setting');
            if (entry.type === "checkbox") {
                let selector = $(entry).data('selector');
                if (selector) {
                    temp_selectors[setting_name] = temp_selectors[setting_name] || [];
                    if (entry.checked) {
                        temp_selectors[setting_name].push(selector);
                    }
                } else {
                    Danbooru[program_key].user_settings[setting_name] = entry.checked;
                }
            } else if (entry.type === "text") {
                 let user_setting = settings_config[setting_name].parse($(entry).val());
                 if (settings_config[setting_name].validate(user_setting)) {
                    Danbooru[program_key].user_settings[setting_name] = user_setting;
                 } else {
                    invalid_setting = true;
                 }
                 $(entry).val(Danbooru[program_key].user_settings[setting_name]);
            }
        });
        $.each(temp_selectors,(setting_name)=>{
            Danbooru[program_key].user_settings[setting_name] = temp_selectors[setting_name];
        });
        JSPLib.storage.setStorageData(`${program_shortcut}-user-settings`,Danbooru[program_key].user_settings,localStorage);
        Danbooru[program_key].channel && Danbooru[program_key].channel.postMessage({type: "settings", user_settings: Danbooru[program_key].user_settings});
        if (!invalid_setting) {
            Danbooru.Utility.notice(`${program_name}: Settings updated!`);
        } else {
            Danbooru.Utility.error("Error: Some settings were invalid!")
        }
    });
}

function ResetUserSettingsClick(program_shortcut,program_name,delete_keys,reset_settings) {
    let program_key = program_shortcut.toUpperCase();
    $(`#${program_shortcut}-resetall`).click((e)=>{
        if (confirm(`This will reset all of ${program_name}'s settings.\n\nAre you sure?`)) {
            $.each(settings_config,(setting)=>{
                Danbooru[program_key].user_settings[setting] = settings_config[setting].default;
            });
            $(`#${program_shortcut}-settings .${program_shortcut}-setting[id]`).each((i,entry)=>{
                let $input = $(entry);
                let setting_name = $input.parent().parent().data('setting');
                if (entry.type === "checkbox") {
                    let selector = $input.data('selector');
                    if (selector) {
                        $input.prop('checked', IsSettingEnabled(setting_name,selector));
                        $input.checkboxradio("refresh");
                    } else {
                        $input.prop('checked', Danbooru[program_key].user_settings[setting_name]);
                    }
                } else if (entry.type === "text") {
                     $input.val(Danbooru[program_key].user_settings[setting_name]);
                }
            });
            $.each(delete_keys,(i,key)=>{
                localStorage.removeItem(key);
            });
            Object.assign(Danbooru[program_key],reset_settings);
            JSPLib.storage.setStorageData(`${program_shortcut}-user-settings`,Danbooru[program_key].user_settings,localStorage);
            Danbooru[program_key].channel && Danbooru[program_key].channel.postMessage({type: "reset", user_settings: Danbooru[program_key].user_settings});
            Danbooru.Utility.notice(`${program_name}: Settings reset to defaults!`);
        }
    });
}

const display_counter = `
<div id="el-search-query-display" style="margin:0.5em;font-size:150%;border:lightgrey solid 1px;padding:0.5em;width:7.5em;display:none">
    Pages left: <span id="el-search-query-counter">...</span>
</div>`;

function GetCheckboxRadioSelected(selector) {
    return $(selector).map((i,input)=>{return (input.checked ? $(input).data('selector') : undefined);}).toArray();
}

function PostEventPopulateControl() {
    $("#el-search-query-get").click(async (e)=>{
        let post_events = GetCheckboxRadioSelected(`[data-setting="post_events"] [data-selector]`);
        let operation = GetCheckboxRadioSelected(`[data-setting="operation"] [data-selector]`);
        let search_query = $("#el-setting-search-query").val();
        if (post_events.length === 0 || operation.length === 0) {
            Danbooru.Utility.notice("Must select at least one post event type!");
        } else if (search_query === "") {
            Danbooru.Utility.notice("Must have at least one search term!");
        } else {
            $("#el-search-query-display").show();
            let posts = await GetPostsCountdown(100,search_query,"#el-search-query-counter");
            let postids = JSPLib.utility.getObjectAttributes(posts,'id');
            let post_changes = [];
            let was_subscribed = [];
            let new_subscribed = [];
            $.each(post_events,(i,eventtype)=>{
                let typelist = GetList(eventtype);
                switch (operation[0]) {
                    case "add":
                        new_subscribed = JSPLib.utility.setDifference(postids,typelist);
                        was_subscribed = [];
                        post_changes = post_changes.concat(new_subscribed);
                        typelist = JSPLib.utility.setUnion(typelist,postids);
                        break;
                    case "subtract":
                        new_subscribed = [];
                        was_subscribed = JSPLib.utility.setIntersection(postids,typelist);
                        post_changes = post_changes.concat(was_subscribed)
                        typelist = JSPLib.utility.setDifference(typelist,postids);
                        break;
                    case "overwrite":
                        was_subscribed = JSPLib.utility.setDifference(typelist,postids);
                        new_subscribed = JSPLib.utility.setDifference(postids,typelist);
                        post_changes = post_changes.concat(postids);
                        typelist = postids;
                }
                Danbooru.EL.subscribelist[eventtype] = typelist;
                setTimeout(()=>{JSPLib.storage.setStorageData(`el-${eventtype}list`,Danbooru.EL.subscribelist[eventtype],localStorage);}, 1);
                Danbooru.EL.channel.postMessage({type: "reload", eventtype: eventtype, was_subscribed: was_subscribed, new_subscribed: new_subscribed, eventlist: Danbooru.EL.subscribelist[eventtype]});
            });
            $("#el-search-query-counter").html(0);
            post_changes = JSPLib.utility.setUnique(post_changes);
            Danbooru.Utility.notice(`Subscriptions were changed by ${post_changes.length} posts!`);
        }
    });
}

function RenderSettingsMenu() {
    $("#event-listener").append(usage_settings);
    $("#el-notice-settings").append(RenderCheckbox("el",'autolock_notices'));
    $("#el-notice-settings").append(RenderCheckbox("el",'mark_read_topics'));
    $("#el-event-settings").append(RenderCheckbox("el",'filter_user_events'));
    $("#el-event-settings").append(RenderCheckbox("el",'filter_untranslated_commentary'));
    $("#el-event-settings").append(RenderInputSelectors("el",'events_enabled','checkbox'));
    $("#el-event-settings").append(RenderInputSelectors("el",'autosubscribe_enabled','checkbox'));
    $("#el-network-settings").append(RenderTextinput("el",'recheck_interval'));
    $("#el-subscribe-controls").append(RenderInputSelectorsControl('el','post_events','checkbox',['comment','note','commentary'],[],'Select which events to populate.'));
    $("#el-subscribe-controls").append(RenderInputSelectorsControl('el','operation','radio',['add','subtract','overwrite'],['add'],'Select how the query will affect existing subscriptions.'));
    $("#el-subscribe-controls").append(RenderTextinputControl('el','search_query','Enter a tag search query to populate. See <a href="/wiki_pages/43049" style="color:#0073ff">Help:Cheatsheet</a> for more info.',50));
    $("#el-subscribe-controls").append(display_counter);
    $(".el-selectors input").checkboxradio();
    $(".el-selectors .ui-state-hover").removeClass('ui-state-hover');
    SaveUserSettingsClick('el','EventListener');
    ResetUserSettingsClick('el','EventListener',localstorage_keys,program_reset_keys);
    PostEventPopulateControl();
}

//Main menu tabs

const css_themes_url = 'https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.12.1/themes/base/jquery-ui.css';

const settings_field = `
<fieldset id="userscript-settings-menu" style="display:none">
  <ul id="userscript-settings-tabs">
  </ul>
  <div id="userscript-settings-sections">
  </div>
</fieldset>`;

function RenderTab(program_name,program_key) {
    return `<li><a href="#${program_key}">${program_name}</a></li>`;
}

function RenderSection(program_key) {
    return `<div id="${program_key}"></div>`;
}

function MainSettingsClick() {
    if (!IsNamespaceBound(`[href="#userscript-menu"`,'click','jsplib.menuchange')) {
        $(`[href="#userscript-menu"`).on('click.jsplib.menuchange',(e)=>{
            $(`#edit-options a[href$="settings"]`).removeClass("active");
            $(e.target).addClass("active");
            $(".edit_user > fieldset").hide();
            $("#userscript-settings-menu").show();
            $('[name=commit]').hide();
            e.preventDefault();
        });
    }
}
function OtherSettingsClicks() {
    if (!IsNamespaceBound("#edit-options a[href$=settings]",'click','jsplib.menuchange')) {
        $("#edit-options a[href$=settings]").on('click.jsplib.menuchange',(e)=>{
            $(`[href="#userscript-menu"`).removeClass('active');
            $("#userscript-settings-menu").hide();
            $('[name=commit]').show();
            e.preventDefault()
        });
    }
}

function InstallSettingsMenu(program_name) {
    let program_key = KebabCase(program_name);
    if ($("#userscript-settings-menu").length === 0) {
        $(`input[name="commit"]`).before(settings_field);
        $("#edit-options").append('| <a href="#userscript-menu">Userscript Menus</a>');
        //Periodic recheck in case other programs remove/rebind click events
        setInterval(()=>{
            MainSettingsClick();
            OtherSettingsClicks();
        },1000);
        AddStyleSheet(css_themes_url);
    } else {
        $("#userscript-settings-menu").tabs("destroy");
    }
    $("#userscript-settings-tabs").append(RenderTab(program_name,program_key));
    $("#userscript-settings-sections").append(RenderSection(program_key));
    //Sort the tabs alphabetically
    $("#userscript-settings-tabs li").sort(function(a, b) {
        try {
            return a.children[0].innerText.localeCompare(b.children[0].innerText);
        } catch (e) {
            return 0;
        }
    }).each(function() {
        var elem = $(this);
        elem.remove();
        $(elem).appendTo("#userscript-settings-tabs");
    });
    $("#userscript-settings-menu").tabs();
}

/****Main****/

function main() {
    $("#dmail-notice").hide();
    Danbooru.EL = {
        username: JSPLib.utility.getMeta('current-user-name'),
        userid: parseInt(JSPLib.utility.getMeta('current-user-id')),
        lastids: {
            user: {},
            subscribe: {}
        },
        subscribelist: {},
        openlist: {},
        marked_topic: []
    };
    if (Danbooru.EL.username === "Anonymous") {
        JSPLib.debug.debuglog("User must log in!");
        return;
    } else if ((typeof Danbooru.EL.username !== "string") || !JSPLib.validate.validateID(Danbooru.EL.userid)) {
        JSPLib.debug.debuglog("Invalid meta variables!");
        return;
    }
    Danbooru.EL.user_settings = LoadUserSettings('el');
    Danbooru.EL.locked_notice = Danbooru.EL.user_settings.autolock_notices;
    Danbooru.EL.channel = new BroadcastChannel('EventListener');
    Danbooru.EL.channel.onmessage = BroadcastEL;
    InitializeNoticeBox();
    var promise_array = [];
    if ((CheckTimeout() || HasEvents()) && ReserveSemaphore()) {
        SetRecheckTimeout();
        if (IsSettingEnabled('events_enabled','dmail') && CheckWaiting('dmail')) {
            promise_array.push(CheckUserType('dmail'));
        }
        if (IsSettingEnabled('events_enabled','flag') && CheckWaiting('flag')) {
            promise_array.push(CheckUserType('flag'));
        }
        if (IsSettingEnabled('events_enabled','appeal') && CheckWaiting('appeal')) {
            promise_array.push(CheckUserType('appeal'));
        }
        if (IsSettingEnabled('events_enabled','spam') && CheckWaiting('spam')) {
            promise_array.push(CheckUserType('spam'));
        }
        if (IsSettingEnabled('events_enabled','comment') && CheckList('comment') && CheckWaiting('comment')) {
            JSPLib.utility.setCSSStyle(comment_css,'comment');
            promise_array.push(CheckSubscribeType('comment'));
        }
        if (IsSettingEnabled('events_enabled','forum') && CheckList('forum') && CheckWaiting('forum')) {
            JSPLib.utility.setCSSStyle(forum_css,'forum');
            promise_array.push(CheckSubscribeType('forum'));
        }
        if (IsSettingEnabled('events_enabled','note') && CheckList('note') && CheckWaiting('note')) {
            promise_array.push(CheckSubscribeType('note'));
        }
        if (IsSettingEnabled('events_enabled','commentary') && CheckList('commentary') && CheckWaiting('commentary')) {
            promise_array.push(CheckSubscribeType('commentary'));
        }
        CheckAllEvents(promise_array).then(()=>{
            FreeSemaphore();
        });
    } else {
        JSPLib.debug.debuglog("Waiting...");
    }
    if ($("#c-posts #a-show").length) {
        InitializePostShowMenu();
    } else if ($("#c-comments #a-index #p-index-by-post").length) {
        InitializeCommentPartialPostLinks();
    } else if ($("#c-comments #a-index #p-index-by-comment").length) {
        InitializeCommentPartialCommentLinks("#p-index-by-comment .post-preview");
    } else if ($("#c-forum-topics #a-show,#c-forum-posts #a-show").length) {
        InitializeTopicShowMenu();
    } else if ($("#c-forum-topics #a-index,#c-forum-posts #a-index").length) {
        InitializeTopicIndexLinks(document);
    }
     if ($("#c-users #a-edit").length) {
        InstallSettingsMenu("EventListener");
        RenderSettingsMenu();
    }
    if ($(`#image-container[data-uploader-id="${Danbooru.EL.userid}"]`).length) {
        SubscribeMultiLinkCallback();
    }
    JSPLib.utility.setCSSStyle(eventlistener_css,'program');
}

/****Execution start****/

JSPLib.load.programInitialize(main,'EL',program_load_required_variables,program_load_required_selectors);
