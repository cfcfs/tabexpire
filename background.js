var DELAY = 2*24*60; // minutes
var EVENT_PREFIX = 'tabexpire.';

console.log('tabexpire loading');
loadExtension();

function loadExtension() {
    rootFolderCreation = createFolder();
    rootFolderCreation.then(null, onError);
    loadTabData().then(lastSessionUsedDates => {
        currentSessionUsedDates = new Map();
        browser.alarms.onAlarm.addListener(getAlarmHandler(currentSessionUsedDates, rootFolderCreation));
        queryingTabs = browser.tabs.query({}).then(tabs => {
            setTabAlarms(tabs, currentSessionUsedDates, lastSessionUsedDates);
            browser.alarms.create(EVENT_PREFIX+'store', {'periodInMinutes': 1});
            browser.tabs.onActivated.addListener(info => resetAlarm(info.tabId, currentSessionUsedDates));
            browser.tabs.onCreated.addListener(tab => createAlarm(tab.id, currentSessionUsedDates));
            browser.tabs.onRemoved.addListener((tabId, info) => { if (!info.isWindowClosing) removeAlarm(tabId, currentSessionUsedDates) });
        }, onError);
    }, onError);
}

function loadTabData() {
    return new Promise(function(resolve, reject) {
        console.log('loadTabData');
        var gettingStoredDates = browser.storage.local.get();
        gettingStoredDates.then(results => {
            var lastSessionUsedDates = new Map();
            stored = results.tabexpire;
            if (stored) {
                for (var key of Object.keys(stored)) {
                    lastSessionUsedDates.set(key, new Date(stored[key])); 
                    console.log(`Retriving ${key} : ${stored[key]}`); 
                }
            }
            lastSessionUsedDates.forEach((value, key, map) => { console.log(`${key}: ${map[key]}`); });
            resolve(lastSessionUsedDates);
        }, reject);
    });
}

function storeTabData(currentSessionUsedDates) {
    tabexpire = {};
    browser.tabs.query({}).then(tabs => {
        var tabDict = new Map()
        tabs.forEach(tab => { 
            tabDict.set(tab.id, tab);
        });
        for (var [key, value] of currentSessionUsedDates) {
            //console.log(`Adding to store ${key} : ${tabDict.get(key)}`);
            var tab = tabDict.get(key);
            if (tab) {
                tabexpire[tab.url] = value; 
            }
        }
        browser.storage.local.set({tabexpire}).then(null, onError);
    });
}

function createAlarm(tabId, currentSessionUsedDates) { 
    console.log(`Created ${tabId}`) ;
    var lastUsed = currentSessionUsedDates.get(tabId) || new Date();
    if (!currentSessionUsedDates.get(tabId)) 
        currentSessionUsedDates.set(tabId, lastUsed);
    createAlarmAt(getAlarmName(tabId), getAlarmTrigger(lastUsed));
}

function removeAlarm(tabId, currentSessionUsedDates) {
    console.log(`Removed ${tabId}`) ;
    var alarmName = getAlarmName(tabId);
    browser.alarms.clear(alarmName).then(alarm => {
        console.log(`Alarm ${alarmName} removed`); 
        currentSessionUsedDates.delete(tabId);
    });
}

function resetAlarm(tabId, currentSessionUsedDates) { 
    console.log(`Activated ${tabId}`);
    var alarmName = getAlarmName(tabId);
    browser.alarms.clear(alarmName).then(alarm => {
        console.log(`Alarm ${alarmName} removed`); 
        currentSessionUsedDates.delete(tabId);
        var lastUsed = new Date();
        currentSessionUsedDates.set(tabId, lastUsed);
        createAlarmAt(getAlarmName(tabId), getAlarmTrigger(lastUsed));
    });
}

function createAlarmAt(alarmName, alarmWhen) {
    browser.alarms.get(alarmName).then(alarm => {
        if (alarm) { 
            console.log(`Alarm ${alarm.name} found`); 
            return;
        }
        browser.alarms.create(alarmName, {when: alarmWhen });
        console.log(`Created alarm ${alarmName} at ${alarmWhen}`);
    });
}

function getAlarmHandler(currentSessionUsedDates, rootFolderCreation) {
    return function(alarm) {
        console.log(`Handling ${alarm.name}`);
        if (!alarm.name.startsWith(EVENT_PREFIX)) return;
        var name = alarm.name.substring(EVENT_PREFIX.length);
        if (name == 'store') {
            storeTabData(currentSessionUsedDates);
        } else {
            var queryingTabs = browser.tabs.get(+name);
            queryingTabs.then(tab => {
                rootFolderCreation.then(folder => 
                    bookmarkOnFolderAndClose(tab, currentSessionUsedDates, folder, () => { currentSessionUsedDates.delete(tab.id); }),
                    onError
                    );
            }, onError);
        }
    }
}

function setTabAlarms(tabs, currentSessionUsedDates, lastSessionUsedDates) {
    var now = new Date();
    console.log('Tabs:');
    for (let tab of tabs) {
        var id = tab.id;
        if (id == tabs.TAB_ID_NONE) continue;
        var url = tab.url;
        console.log(`${tab.id} [${tab.url}]`);
        var lastUsed = currentSessionUsedDates.get(id) || lastSessionUsedDates.get(url) || now;
        //console.log(alarmWhen);
        if (!currentSessionUsedDates.get(id)) 
            currentSessionUsedDates.set(id, lastUsed);
        createAlarmAt(getAlarmName(id), getAlarmTrigger(lastUsed));
    }
}


function createFolder() {
    return new Promise(function(resolve, reject) {
        var folderName = 'tabexpire';
        var gettingTree = browser.bookmarks.getTree();
        gettingTree.then(tree => {
            root = tree[0];
            var searchingFolder = browser.bookmarks.search({title: `${folderName}`});
            searchingFolder.then(items => {
                var folder = null;
                for (item of items) {
                    console.log(`Searching root folder: got item ${item.id} [${item.parentId}]: ${item.title} [${item.url}]`);
                    if (!item.url) {
                        folder = item;
                        break;
                    }
                }
                if (folder) {
                    resolve(folder)
                } else {
                    console.log(`Folder ${folderName} not found. Creating.`);
                    var creatingBookmark = browser.bookmarks.create({ title: folderName });
                    creatingBookmark.then(node => {
                        console.log(`Folder ${folderName} created`);
                        resolve(node);
                    });
                }
            }, reject);
        }, reject);
    });
}

function bookmarkOnFolderAndClose(tab, currentSessionUsedDates, folder, onSuccess) {
    if (!tab.incognito) {
        var searchingFolder = browser.bookmarks.search({url: tab.url});
        searchingFolder.then(items => {
            if (items.length == 0) {
                var creatingBookmark = browser.bookmarks.create({
                    title: tab.name,
                    url: tab.url,
                    parentId: folder.id
                });
                creatingBookmark.then(node => {
                    console.log(`Tab ${tab.id} with url ${tab.url} bookmarked`);
                    closeTab(tab, currentSessionUsedDates, onSuccess);
                });
            } else {
                console.log(`Tab ${tab.id} with url ${tab.url} already bookmarked`);
                closeTab(tab, currentSessionUsedDates, onSuccess);
            }
        }, onError);
    } else {
        closeTab(tab, currentSessionUsedDates, onSuccess);
    }
}

function closeTab(tab, currentSessionUsedDates, onSuccess) {
    browser.tabs.remove(tab.id).then({
        if (onSuccess) {
            onSuccess();
        }
    }, onError);
}

function getAlarmName(tabId) {
    return `${EVENT_PREFIX}${tabId}`;
}

function getAlarmTrigger(lastUsed) {
    if (!lastUsed) lastUsed = new Date();
    return lastUsed.valueOf() + DELAY * 60 * 1000; //ms
}

function onError(error) {
    console.log(`Error: ${error}`);
}

