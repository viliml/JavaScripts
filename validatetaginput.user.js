// ==UserScript==
// @name         ValidateTagInput
// @namespace    https://github.com/BrokenEagle/JavaScripts
// @version      25.0
// @source       https://danbooru.donmai.us/users/23799
// @description  Validates tag add/remove inputs on a post edit or upload.
// @author       BrokenEagle
// @match        *://*.donmai.us/posts*
// @match        *://*.donmai.us/uploads*
// @match        *://*.donmai.us/users/*/edit
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/BrokenEagle/JavaScripts/stable/validatetaginput.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/localforage/1.5.2/localforage.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/validate.js/0.12.0/validate.min.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/debug.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/load.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/storage.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/validate.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/utility.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/statistics.js
// @require      https://raw.githubusercontent.com/BrokenEagle/JavaScripts/20180723/lib/danbooru.js
// ==/UserScript==

//Global variables

//Variables for debug.js
JSPLib.debug.debug_console = false;
JSPLib.debug.pretext = "VTI:";
JSPLib.debug.level = JSPLib.debug.INFO;

//Variables for load.js
const program_load_required_variables = ['window.jQuery','window.Danbooru'];

//Wait time for quick edit box
// 1. Let box close before reenabling the submit button
// 2. Let box open before querying the implications
const quickedit_wait_time = 1000;

//Polling interval for checking program status
const timer_poll_interval = 100;

//Expiration time is one month
const validatetag_expiration_time = JSPLib.utility.one_month;

//Regex that matches the prefix of all program cache data
const program_cache_regex = /^(?:ti|ta)-/;

//Validate constants

const relation_constraints = {
    entry: {
        expires : JSPLib.validate.expires_constraints,
        value: JSPLib.validate.array_constraints
    },
    value: JSPLib.validate.stringonly_constraints
};

//HTML constants

const submit_button = `
<input id="validate-tags" type="button" class="ui-button ui-widget ui-corner-all" value="Submit">
<input id="check-tags" type="button" class="ui-button ui-widget ui-corner-all" value="Check">`;

const input_validator = `
<div id="validation-input" style="display:none">
<label for="skip-validate-tags">Skip Validation</label>
<input type="checkbox" id="skip-validate-tags">
</div>`;

const reset_storage = `
<div class="input">
    <label>Site data</label>
    <p><a href="#" id="reset-storage-link">Reset cached data</a></p>
</div>`;

const warning_messages = `
<div id="warning-no-rating" class="error-messages ui-state-error ui-corner-all" style="display:none"><strong>Error</strong>: Must specify a rating</div>
<div id="warning-new-tags" class="error-messages ui-state-error ui-corner-all" style="display:none"></div>
<div id="warning-bad-removes" class="error-messages ui-state-highlight ui-corner-all" style="display:none"></div>`;

/**FUNCTIONS**/

//Validate functions

function ValidateRelationEntry(key,entry) {
    if (entry === null) {
        JSPLib.debug.debuglog(key,"entry not found!");
        return false;
    }
    let check = validate(entry,relation_constraints.entry);
    if (check !== undefined) {
        JSPLib.validate.printValidateError(key,check);
        return false
    }
    for (let i = 0;i < entry.value.length; i++) {
        check = validate(entry.value[i],relation_constraints.value);
        if (check !== undefined) {
            JSPLib.validate.printValidateError(key,check);
            return false
        }
    }
    return true;
}

//Library functions

function DebugExecute(func) {
    if (JSPLib.debug.debug_console) {
        func();
    }
}

function GetExpiration(expires) {
    return Date.now() + expires;
}

function ValidateExpires(actual_expires,expected_expires) {
    //Resolve to true if the actual_expires is bogus, has expired, or the expiration is too long
    return !Number.isInteger(actual_expires) || (Date.now() > actual_expires) || ((actual_expires - Date.now()) > expected_expires);
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

function InstallScript(url) {
    return $.ajax({
        url: url,
        dataType: "script",
        cache: true
    });
}

function KebabCase(string) {
    return string.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g,'-').toLowerCase();
}

function DisplayCase(string) {
    return JSPLib.utility.titleizeString(string.toLowerCase().replace(/[_]/g,' '));
}

//Helper functions

function BroadcastVTI(ev) {
    JSPLib.debug.debuglog(`BroadcastChannel (${ev.data.type}):`,ev.data);
    if (ev.data.type === "settings") {
        Danbooru.VTI.user_settings = ev.data.user_settings;
    } else if (ev.data.type === "reset") {
        Danbooru.VTI.user_settings = ev.data.user_settings;
        Object.assign(Danbooru.VTI,program_reset_keys);
    } else if (ev.data.type === "purge") {
        $.each(sessionStorage,(key)=>{
            if (key.match(program_cache_regex)) {
                sessionStorage.removeItem(key);
            }
        });
    }
}

function getTagList() {
    return stripQuoteSourceMetatag($("#upload_tag_string,#post_tag_string").val()).split(/[\s\n]+/).map(tag=>{return tag.toLowerCase();});
}

function stripQuoteSourceMetatag(str) {
    return str.replace(/source:"[^"]+"\s?/g,'');
}

function filterMetatags(array) {
    return array.filter(value=>{return !value.match(/(?:rating|-?parent|source|-?locked|-?pool|newpool|-?fav|child|-?favgroup|upvote|downvote):/i);});
}

//Typetags are ignored for tag adds, and do nothing for tag removes
function filterTypetags(array) {
    return array.filter(value=>{return !value.match(/(?:general|gen|artist|art|copyright|copy|co|character|char|ch|meta):/i);});
}

function filterNegativetags(array) {
    return array.filter(value=>{return value[0]!='-';});
}

function getNegativetags(array) {
    return filterTypetags(array.filter(value=>{return value[0]=='-';}).map(value=>{return value.substring(1);}));
}

function transformTypetags(array) {
    return array.map(value=>{return value.match(/(?:general:|gen:|artist:|art:|copyright:|copy:|co:|character:|char:|ch:|meta:)?(.*)/i)[1];});
}

function getCurrentTags() {
    return filterMetatags(JSPLib.utility.filterEmpty(getTagList()));
}

function getAllRelations(tag,implicationdict) {
    var tmp = [];
    if (tag in implicationdict) {
        for(let i=0;i<implicationdict[tag].length;i++) {
            tmp.push(implicationdict[tag][i]);
            let tmp2 = getAllRelations(implicationdict[tag][i],implicationdict);
            tmp = tmp.concat(tmp2);
        }
        return tmp;
    } else {
        return [];
    }
}

//Network functions

async function queryTagAlias(tag) {
    let consequent = "";
    let entryname = 'ta-'+tag;
    let storeditem = await JSPLib.storage.checkLocalDB(entryname,ValidateRelationEntry);
    if (!storeditem) {
        JSPLib.debug.debuglog("Querying alias:",tag);
        let data = await JSPLib.danbooru.submitRequest('tag_aliases',{search:{antecedent_name:tag,status:'active'}},[],entryname);
        if (data.length) {
            //Alias antecedents are unique, so no need to check the size
            JSPLib.debug.debuglog("Alias:",tag,data[0].consequent_name);
            Danbooru.VTI.aliastags.push(tag);
            consequent = [data[0].consequent_name];
        } else {
            consequent = [];
        }
        JSPLib.storage.saveData(entryname,{'value':consequent,'expires':Date.now() + validatetag_expiration_time});
    } else {
        consequent = storeditem.value;
        if (consequent.length) {
            JSPLib.debug.debuglog("Alias:",tag,consequent[0]);
            Danbooru.VTI.aliastags.push(tag);
        }
    }
}

//Queries aliases of added tags... can be called multiple times
async function queryTagAliases(taglist) {
    JSPLib.debug.debugTime("queryTagAliases");
    for (let i = 0;i < taglist.length;i++) {
        if (Danbooru.VTI.seenlist.includes(taglist[i])) {
            continue;
        }
        Danbooru.VTI.seenlist.push(taglist[i]);
        Danbooru.VTI.aliases_promise_array.push(queryTagAlias(taglist[i]));
    }
    await Promise.all(Danbooru.VTI.aliases_promise_array);
    JSPLib.debug.debugTimeEnd("queryTagAliases");
    JSPLib.debug.debuglog("Aliases:",Danbooru.VTI.aliastags);
}

async function queryTagImplication(tag) {
    let entryname = 'ti-'+tag;
    let storeditem = await JSPLib.storage.checkLocalDB(entryname,ValidateRelationEntry);
    if (!storeditem) {
        JSPLib.debug.debuglog("Querying implication:",tag);
        let data = await JSPLib.danbooru.submitRequest('tag_implications',{limit:100,search:{consequent_name:tag,status:'active'}},[],entryname);
        let implications = data.map(entry=>{return entry.antecedent_name;});
        Danbooru.VTI.implicationdict[tag] = implications;
        JSPLib.storage.saveData(entryname,{'value':implications,'expires':Date.now() + validatetag_expiration_time});
    } else {
        Danbooru.VTI.implicationdict[tag] = storeditem.value;
    }
}

//Queries implications of preexisting tags... called once per image
async function queryTagImplications(taglist) {
    JSPLib.debug.debugTime("queryTagImplications");
    for (let i = 0;i < taglist.length;i++) {
        Danbooru.VTI.implications_promise_array.push(queryTagImplication(taglist[i]));
    }
    await Promise.all(Danbooru.VTI.implications_promise_array);
    JSPLib.debug.debugTimeEnd("queryTagImplications");
    JSPLib.debug.debuglog("Implications:",Danbooru.VTI.implicationdict);
}

//Click functions

function postModeMenuClick(e) {
    let s = $("#mode-box select").val();
    if (s === "edit") {
        $("#validation-input,#warning-no-rating,#warning-new-tags,#warning-bad-removes").hide();
        let post_id = $(e.target).closest("article").data("id");
        let $post = $("#post_" + post_id);
        Danbooru.VTI.preedittags = $post.data("tags").split(' ');
        JSPLib.debug.debuglog("Preedit tags:",Danbooru.VTI.preedittags);
        //Wait until the edit box loads before querying implications
        if (Danbooru.VTI.user_settings.implication_check_enabled) {
            setTimeout(()=>{queryTagImplications(Danbooru.VTI.preedittags);},quickedit_wait_time);
        }
    } else if (s === "view") {
        return;
    }
    e.preventDefault();
}

async function checkTagsClick(e) {
    //Prevent code from being reentrant until finished processing
    if (checkTagsClick.isready) {
        checkTagsClick.isready = false;
        JSPLib.debug.debugTime("checkTagsClick");
        $("#validate-tags")[0].setAttribute('disabled','true');
        $("#check-tags")[0].setAttribute('disabled','true');
        $("#check-tags")[0].setAttribute('value','Checking...');
        let statuses = await Promise.all([validateTagAddsWrap(),validateTagRemovesWrap()]);
        if (statuses[0] && statuses[1]) {
            $(window).trigger("danbooru:notice","Tags good to submit!");
        } else {
            $(window).trigger("danbooru:error","Tag validation failed!");
        }
        $("#validate-tags")[0].removeAttribute('disabled');
        $("#check-tags")[0].removeAttribute('disabled');
        $("#check-tags")[0].setAttribute('value','Check');
        checkTagsClick.isready = true;
        JSPLib.debug.debugTimeEnd("checkTagsClick");
    }
}
checkTagsClick.isready = true;

async function validateTagsClick(e) {
    //Prevent code from being reentrant until finished processing
    if (validateTagsClick.isready) {
        validateTagsClick.isready = false;
        JSPLib.debug.debugTime("validateTagsClick");
        $("#validate-tags")[0].setAttribute('disabled','true');
        $("#check-tags")[0].setAttribute('disabled','true');
        $("#validate-tags")[0].setAttribute('value','Submitting...');
        let statuses = await Promise.all([validateTagAddsWrap(),validateTagRemovesWrap()]);
        if (statuses[0] && statuses[1]) {
            JSPLib.debug.debuglog("Submit request!");
            $("#form,#quick-edit-form").trigger("submit");
            if ($("#c-uploads #a-new,#c-posts #a-show").length) {
                JSPLib.debug.debuglog("Disabling return key!");
                $("#upload_tag_string,#post_tag_string").off("keydown.danbooru.submit");
            }
            if ($("#c-uploads #a-new").length) {
                //Check for the triggering of Danbooru's client validation (file/source/rating)
                reenableSubmitCallback.timer = setInterval(reenableSubmitCallback,timer_poll_interval);
            } else if ($("#c-posts #a-index").length) {
                //Wait until the edit box closes to reenable the submit button click
                setTimeout(()=>{
                    JSPLib.debug.debuglog("Ready for next edit!");
                    $("#validate-tags")[0].removeAttribute('disabled');
                    $("#check-tags")[0].removeAttribute('disabled');
                    $("#validate-tags")[0].setAttribute('value','Submit');
                    $("#skip-validate-tags")[0].checked = false;
                    validateTagsClick.isready = true;
                },quickedit_wait_time);
            }
        } else {
            JSPLib.debug.debuglog("Validation failed!");
            $("#validate-tags")[0].removeAttribute('disabled');
            $("#check-tags")[0].removeAttribute('disabled');
            $("#validate-tags")[0].setAttribute('value','Submit');
            validateTagsClick.isready = true;
        }
        JSPLib.debug.debugTimeEnd("validateTagsClick");
    }
}
validateTagsClick.isready = true;

//Timer/callback functions

function reenableSubmitCallback() {
    if ($("#client-errors").css("display") !== "none") {
        clearInterval(reenableSubmitCallback.timer);
        JSPLib.debug.debuglog("Danbooru's client validation failed!");
        $("#validate-tags")[0].removeAttribute('disabled');
        $("#validate-tags")[0].setAttribute('value','Submit');
        $("#upload_tag_string").on("keydown.danbooru.submit", null, "return", e=>{
            $("#validate-tags").click();
            e.preventDefault();
        });
        validateTagsClick.isready = true;
    }
}

function rebindHotkey() {
    if (IsNamespaceBound("#upload_tag_string,#post_tag_string",'keydown','danbooru.submit')) {
        clearInterval(rebindHotkey.timer);
        $("#upload_tag_string,#post_tag_string").off("keydown.danbooru.submit").on("keydown.danbooru.submit", null, "return", (e)=>{
            $("#validate-tags").click();
            e.preventDefault();
        });
    }
}

//Main execution functions

async function validateTagAddsWrap() {
    JSPLib.debug.debugTime("validateTagAdds");
    let ret_status = await validateTagAdds();
    JSPLib.debug.debugTimeEnd("validateTagAdds");
    return ret_status;
}

async function validateTagAdds() {
    let postedittags = getCurrentTags();
    Danbooru.VTI.addedtags = JSPLib.utility.setDifference(JSPLib.utility.setDifference(filterNegativetags(filterTypetags(postedittags)),Danbooru.VTI.preedittags),getNegativetags(postedittags));
    JSPLib.debug.debuglog("Added tags:",Danbooru.VTI.addedtags);
    if ((Danbooru.VTI.addedtags.length === 0) || $("#skip-validate-tags")[0].checked) {
        JSPLib.debug.debuglog("Tag Add Validation - Skipping!",Danbooru.VTI.addedtags.length === 0,$("#skip-validate-tags")[0].checked);
        $("#warning-new-tags").hide();
        return true;
    }
    let alltags = await JSPLib.danbooru.getAllItems('tags',100,{addons:{search:{name:Danbooru.VTI.addedtags.join(','),hide_empty:'yes'}}});
    Danbooru.VTI.checktags = alltags.map(entry=>{return entry.name;});
    let nonexisttags = JSPLib.utility.setDifference(Danbooru.VTI.addedtags,Danbooru.VTI.checktags);
    if (Danbooru.VTI.user_settings.alias_check_enabled) {
        await queryTagAliases(Danbooru.VTI.addedtags);
        nonexisttags = JSPLib.utility.setDifference(nonexisttags,Danbooru.VTI.aliastags);
    }
    if (nonexisttags.length > 0) {
        JSPLib.debug.debuglog("Tag Add Validation - Nonexistant tags!");
        $.each(nonexisttags,(i,tag)=>{JSPLib.debug.debuglog(i,tag);});
        $("#validation-input").show();
        $("#warning-new-tags").show();
        let taglist = nonexisttags.join(', ');
        $("#warning-new-tags")[0].innerHTML = '<strong>Warning</strong>: The following new tags will be created:  ' + taglist;
    } else {
        JSPLib.debug.debuglog("Tag Add Validation - Free and clear to submit!");
        $("#warning-new-tags").hide();
        return true;
    }
    return false;
}

async function validateTagRemovesWrap() {
    JSPLib.debug.debugTime("validateTagRemoves");
    let ret_status = await validateTagRemoves();
    JSPLib.debug.debugTimeEnd("validateTagRemoves");
    return ret_status;
}

async function validateTagRemoves() {
    if (!Danbooru.VTI.user_settings.implication_check_enabled || $("#skip-validate-tags")[0].checked) {
        JSPLib.debug.debuglog("Tag Remove Validation - Skipping!",$("#skip-validate-tags")[0].checked);
        $("#warning-bad-removes").hide();
        return true;
    }
    await Promise.all(Danbooru.VTI.implications_promise_array);
    let postedittags = transformTypetags(getCurrentTags());
    let removedtags = (JSPLib.utility.setDifference(Danbooru.VTI.preedittags,postedittags)).concat(JSPLib.utility.setIntersection(getNegativetags(postedittags),postedittags));
    let finaltags = JSPLib.utility.setDifference(postedittags,removedtags);
    JSPLib.debug.debuglog("Final tags:",finaltags);
    JSPLib.debug.debuglog("Removed tags:",removedtags);
    let allrelations = [];
    $.each(removedtags,(i,tag)=>{
        let badremoves = JSPLib.utility.setIntersection(getAllRelations(tag,Danbooru.VTI.implicationdict),finaltags);
        if (badremoves.length) {
            allrelations.push(badremoves.toString() + ' -> ' + tag);
        }
    });
    if (allrelations.length) {
        JSPLib.debug.debuglog("Tag Remove Validation - Badremove tags!");
        $.each(allrelations,(i,relation)=>{JSPLib.debug.debuglog(i,relation);});
        $("#validation-input").show();
        $("#warning-bad-removes").show();
        let removelist = allrelations.join('<br>');
        $("#warning-bad-removes")[0].innerHTML = '<strong>Notice</strong>: The following implication relations prevent certain tag removes:<br>' + removelist;
    } else {
        JSPLib.debug.debuglog("Tag Remove Validation - Free and clear to submit!");
        $("#warning-bad-removes").hide();
        return true;
    }
    return false;
}

///Settings menu

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

function RenderLinkclick(program_shortcut,setting_name,display_name,link_text) {
    let setting_key = KebabCase(setting_name);
    return `
<div class="${program_shortcut}-linkclick" style="margin:0.5em">
    <h4>${display_name}</h4>
    <div style="margin-left:0.5em">
        <span class="${program_shortcut}-control-linkclick" style="display:block"><a href="#" id="${program_shortcut}-setting-${setting_key}" style="color:#0073ff">${link_text}</a></span>
    </div>
</div>`;
}

const vti_menu = `
<div id="vti-settings" style="float:left;width:50%">
    <div id="vti-script-message" class="prose">
        <h2>ValidateTagInput</h2>
        <p>Check the forum for the latest on information and updates (<a class="dtext-link dtext-id-link dtext-forum-topic-id-link" href="/forum_topics/14474" style="color:#0073ff">topic #14474</a>).</p>
    </div>
    <div id="vti-process-settings" style="margin-bottom:2em">
        <div id="vti-process-message" class="prose">
            <h4>Process settings</h4>
            <ul>
                <li><b>Alias check enabled:</b> Checks and removes aliased tags from tag add validation.
                    <ul>
                        <li>Turning off no longer queries all tag adds for aliases.</li>
                    </ul>
                </li>
                <li><b>Implications check enabled:</b> Used as the primary source for tag remove validation.
                    <ul>
                        <li>Turning off no longer queries all tags on page load for implications.</li>
                        <li><b>Note:</b> This effectively turns off tag remove validation.</li>
                    </ul>
                </li>
            </ul>
        </div>
    </div>
    <div id="vti-cache-settings" style="margin-bottom:2em">
        <div id="vti-cache-message" class="prose">
            <h4>Cache settings</h4>
            <h5>Cache data</h5>
            <ul>
                <li><b>Tag aliases:</b> Used to determine which removes are bad.</li>
                <li><b>Tag implications:</b> Used to determine if a tag is bad or an alias.</li>
            </ul>
            <h5>Cache controls</h5>
            <ul>
                <li><b>Purge cache:</b> Dumps all of the cached data related to ValidateTagInput.</li>
            </ul>
        </div>
    </div>
    <hr>
    <div id="vti-settings-buttons" style="margin-top:1em">
        <input type="button" id="vti-commit" value="Save">
        <input type="button" id="vti-resetall" value="Factory Reset">
    </div>
</div>`;

const settings_config = {
    alias_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Uncheck to turn off."
    },
    implication_check_enabled: {
        default: true,
        validate: (data)=>{return validate.isBoolean(data);},
        hint: "Uncheck to turn off."
    }
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

async function PurgeCache(regex,domname) {
    Danbooru.Utility.notice("Starting cache deletion...");
    let promise_array = [];
    let purged_count = 0;
    let remaining_count = 0;
    await JSPLib.storage.danboorustorage.iterate((value,key)=>{
        if (key.match(regex)) {
            JSPLib.debug.debuglogLevel("Deleting",key,JSPLib.debug.DEBUG);
            let resp = JSPLib.storage.removeData(key).then(()=>{
                domname && $(domname).html(--remaining_count);
            });
            promise_array.push(resp);
            purged_count += 1;
            domname && $(domname).html(++remaining_count);
        }
    });
    Danbooru.Utility.notice(`Deleting ${purged_count} items...`);
    JSPLib.debug.debuglogLevel(`Deleting ${purged_count} items...`,JSPLib.debug.INFO);
    //Wait at least 5 seconds
    await JSPLib.utility.sleep(5000);
    await Promise.all(promise_array);
    Danbooru.Utility.notice("Finished deleting cached data!");
    JSPLib.debug.debuglogLevel("Finished deleting cached data!",JSPLib.debug.INFO);
}

function PurgeCacheClick(program_shortcut,program_name,regex,domname) {
    let program_key = program_shortcut.toUpperCase();
    $(`#${program_shortcut}-setting-purge-cache`).click((e)=>{
        if (!PurgeCacheClick.is_started && confirm(`This will delete all of ${program_name}'s cached data.\n\nAre you sure?`)) {
            PurgeCacheClick.is_started = true;
            PurgeCache(regex,domname).then(()=>{
                Danbooru[program_key].channel && Danbooru[program_key].channel.postMessage({type: "purge"});
                PurgeCacheClick.is_started = false;
            });;
        }
        e.preventDefault();
    });
}

function RenderSettingsMenu() {
    $("#validate-tag-input").append(vti_menu);
    $("#vti-process-settings").append(RenderCheckbox("vti",'alias_check_enabled'));
    $("#vti-process-settings").append(RenderCheckbox("vti",'implication_check_enabled'));
    $("#vti-cache-settings").append(RenderLinkclick("vti",'purge_cache',`Purge cache (<span id="vti-purge-counter">...</span>)`,"Click to purge"));
    SaveUserSettingsClick('vti','ValidateTagInput');
    ResetUserSettingsClick('vti','ValidateTagInput',[],{});
    PurgeCacheClick('vti','ValidateTagInput',program_cache_regex,"#vti-purge-counter");
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

//Main program

function main() {
    Danbooru.VTI = {
        user_settings: LoadUserSettings('vti'),
        channel: new BroadcastChannel('ValidateTagInput'),
        aliastags: [],
        seenlist: [],
        aliases_promise_array: [],
        implicationdict: {},
        implications_promise_array: []
    }
    Danbooru.VTI.channel.onmessage = BroadcastVTI;
    if ($("#c-users #a-edit").length) {
        InstallScript("https://cdn.rawgit.com/jquery/jquery-ui/1.12.1/ui/widgets/tabs.js").done(()=>{
            InstallSettingsMenu("ValidateTagInput");
            RenderSettingsMenu();
        });
        return;
    }
    if ($("#c-uploads #a-new").length) {
        //Upload tags will always start out blank
        Danbooru.VTI.preedittags = [];
    } else if ($("#c-posts #a-show").length) {
        Danbooru.VTI.preedittags = JSPLib.utility.filterEmpty(getTagList());
        JSPLib.debug.debuglog("Preedit tags:",Danbooru.VTI.preedittags);
        if (Danbooru.VTI.user_settings.implication_check_enabled) {
            queryTagImplications(Danbooru.VTI.preedittags);
        }
    } else if ($("#c-posts #a-index #mode-box").length){
        $(".post-preview a").click(postModeMenuClick);
    } else {
        JSPLib.debug.debuglog("Nothing found!");
        return;
    }
    $("#form [type=submit],#quick-edit-form [type=submit][value=Submit]").after(submit_button);
    $("#form [type=submit],#quick-edit-form [type=submit][value=Submit]").hide();
    if ($("#c-posts #a-index").length) {
        $("#quick-edit-form [type=submit][value=Cancel]").after(input_validator);
        $("#quick-edit-form").after(warning_messages);
    } else{
        $("#check-tags").after(input_validator);
        $("#related-tags-container").before(warning_messages);
    }
    $("#validate-tags").click(validateTagsClick);
    $("#check-tags").click(checkTagsClick);
    rebindHotkey.timer = setInterval(rebindHotkey,timer_poll_interval);
    DebugExecute(()=>{
        window.addEventListener('beforeunload',function () {
            JSPLib.statistics.outputAdjustedMean("ValidateTagInput");
        });
    });
}

//Execution start

JSPLib.load.programInitialize(main,'VTI',program_load_required_variables);
