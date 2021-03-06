// ==UserScript==
// @name         popcorny
// @namespace    studio.mdzz
// @version      0.3.1
// @description  Watch videos together.
// @author       Dwscdv3
// @updateURL    https://github.com/MagicalDevelopersZyosouZone/popcorny/raw/main/popcorny.user.js
// @downloadURL  https://github.com/MagicalDevelopersZyosouZone/popcorny/raw/main/popcorny.user.js
// @homepageURL  https://dwscdv3.com/
// @supportURL   https://github.com/MagicalDevelopersZyosouZone/popcorny/issues
// @license      GPL-3.0-or-later
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @match        *://www.youtube.com/watch?*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        unsafeWindow
// ==/UserScript==

/* global
 *   player
 */

(function() {
    'use strict';

    const Prefix = 'popcorny';
    const DeviationThreshold = 5000;
    const HeartbeatInterval = 5000;
    const PeerPurgeTimeout = 15000;
    const FloatAvatarShowTime = 4000;

    let _ = {}; // An object to store temporary variables from object initializers.

    // You can add support by add site specific code to SiteProfiles.
    // A site profile must based on DefaultBehavior and its nested objects, see profile 'www.bilibili.com' for example.
    const DefaultBehavior = {
        profile: {
            getSelfUID: () => null,
            getNickname: uid => Promise.resolve('Guest'),
            getAvatarURL: uid => Promise.resolve(null),
        },
        video: {
            videoElementSelector: 'video',
            getBaseElement() { return $(this.videoElementSelector); },
            getId() { return location.pathname; },
            setId(value) { location.pathname = value; },
            getPaused() { return this.getBaseElement().paused; },
            setPaused(value) { value ? this.getBaseElement().pause() : this.getBaseElement().play(); },
            getDuration() { return this.getBaseElement().duration; },
            getCurrentTime() { return this.getBaseElement().currentTime; },
            setCurrentTime(value) { this.getBaseElement().currentTime = value; },
            getPlaybackRate() { return this.getBaseElement().playbackRate; },
            setPlaybackRate(value) { this.getBaseElement().playbackRate = value; },
            play() { this.getBaseElement().play(); },
            pause() { this.getBaseElement().pause(); },
            onpause(event) {},
            onplay(event) {},
            onseeking(event) {},
            onratechange(event) {},
        },
        integration: {
            toolbarElementSelector: 'body',
            panelParentElementSelector: 'body',
            newSessionButtonElement: createElement('button', {
                className: `${Prefix}-new-session-button`,
                textContent: 'Watch Together',
                onclick: newSession,
            }),
            floatAvatarElement: _.floatAvatarElement = createElement('img', {
                className: `${Prefix}-avatar`,
            }),
            panelElement: createElement(`${Prefix}-panel`, {
                children: [
                    createElement(`${Prefix}-panel-header`, {
                        children: [
                            '⪘',
                            _.floatAvatarElement,
                        ],
                    }),
                    createElement(`${Prefix}-panel-body`, {
                        children: [
                            createElement(`${Prefix}-panel-body-inner`, {
                                children: [
                                    createElement(`${Prefix}-peer-panel-header`, { textContent: 'Peers' }),
                                    createElement(`${Prefix}-peer-panel`),
                                ],
                            }),
                        ],
                    }),
                ],
            }),
            getPeerElement(peer) {
                return createElement(`${Prefix}-peer`, {
                    children: [
                        createElement('img', {
                            className: `${Prefix}-avatar`,
                            src: peer.avatarURL,
                        }),
                        createElement(`${Prefix}-peer-nickname`, {
                            textContent: peer.nickname,
                        }),
                    ],
                });
            },
        },
        isReady() { return $(this.video.videoElementSelector) && $(this.video.videoElementSelector).duration > 0; },
        style: `
            .${Prefix}-new-session-button {
                position: fixed;
                right: 20px;
                bottom: 20px;
            }
            ${Prefix}-panel {
                display: block;
                position: absolute;
                top: 60px;
                right: 20px;
                z-index: 1000;
            }
            ${Prefix}-panel-header {
                display: block;
                position: absolute;
                right: 0;
                width: 36px;
                height: 36px;
                border-radius: 18px;
                color: white;
                background-color: rgba(255, 255, 255, 0);
                font-size: 24px;
                line-height: 36px;
                text-align: center;
                box-shadow: 0 0 0 black;
                backdrop-filter: blur(5px) brightness(0.75);
                transition: all 0.2s;
                z-index: 1001;
            }
            ${Prefix}-panel-header .${Prefix}-avatar {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                opacity: 0;
                transition: opacity 0.5s;
                pointer-events: none;
            }
            ${Prefix}-panel-header .${Prefix}-avatar.show {
                opacity: 1;
            }
            ${Prefix}-panel:hover ${Prefix}-panel-header {
                color: black;
                background-color: white;
                box-shadow: 1px 1px 5px black;
            }
            ${Prefix}-panel-body {
                display: block;
                position: absolute;
                right: 0;
                width: 150px;
                height: 250px;
                border-radius: 18px;
                visibility: collapse;
                opacity: 0;
                color: white;
                background-color: transparent;
                text-shadow: 1px 1px 2px black;
                backdrop-filter: blur(5px) brightness(0.75);
                transition: all 0.2s;
            }
            ${Prefix}-panel:hover ${Prefix}-panel-body {
                visibility: visible;
                opacity: 1;
            }
            ${Prefix}-panel-body-inner {
                --fade-out-length: 2em;
                display: block;
                height: 100%;
                padding: 1em;
                box-sizing: border-box;
                overflow-y: auto;
                -webkit-mask: linear-gradient(
                    to bottom,
                    transparent,
                    black var(--fade-out-length),
                    black calc(100% - var(--fade-out-length)),
                    transparent 100%);
            }
            ${Prefix}-peer-panel {
                display: block;
            }
            ${Prefix}-peer-panel-header {
                display: block;
                margin-bottom: 0.75em;
                font-family: sans-serif;
                font-size: 175%;
                font-weight: 300;
            }
            ${Prefix}-peer {
                display: flex;
                margin: 1em 0.5em;
                align-items: center;
                line-height: 24px;
            }
            ${Prefix}-peer > img {
                width: 24px;
                height: 24px;
                margin-right: 0.5em;
            }
            .${Prefix}-avatar {
                border-radius: 1000px;
                object-fit: cover;
            }
            `,
    };
    const SiteProfiles = {
        'www.bilibili.com': Object.assign({}, DefaultBehavior, {
            profile: Object.assign({}, DefaultBehavior.profile, {
                getSelfUID: () => $('.vp-container .counts a') && parseInt($('.vp-container .counts a').href.match(/\d+/)[0]),
                getNickname: uid => !uid
                  ? '游客'
                  : fetch(`https://api.bilibili.com/x/web-interface/card?mid=${uid}`)
                    .then(response => response.json())
                    .then(responseBody => responseBody.data.card.name),
                getAvatarURL: uid => !uid
                  ? 'https://static.hdslb.com/images/member/noface.gif'
                  : fetch(`https://api.bilibili.com/x/web-interface/card?mid=${uid}`)
                    .then(response => response.json())
                    .then(responseBody => responseBody.data.card.face.replace(/^((https?:)?\/\/)?/, 'https://')),
            }),
            video: Object.assign({}, DefaultBehavior.video, {
                videoElementSelector: '.bilibili-player-video video',
                getId() { return `${location.pathname},${new URL(location.href).searchParams.get('p') || '1'}`; },
                setId(value) {
                    const [pathname, part] = value.split(',');
                    const url = getShareableURL(serverURL, sessionId);
                    url.pathname = pathname;
                    if (part === '1') {
                        url.searchParams.delete('p');
                    } else {
                        url.searchParams.set('p', part);
                    }
                    location.href = url.href;
                },
                getDuration() { return player.getDuration(); },
                getPaused() { return player.getState() !== 'PLAYING'; },
                setPaused(value) { player.getState() === 'BUFFERING' || (value ? player.pause() : player.play()); },
                getCurrentTime() { return player.getCurrentTime(); },
                setCurrentTime(value) { player.seek(value, this.getPaused()); },
                setPlaybackRate(value) {
                    if (value !== this.getPlaybackRate()) {
                        const speedMenuListElement = $(`.bilibili-player-video-btn-speed-menu-list[data-value="${value}"]`);
                        if (speedMenuListElement && !speedMenuListElement.classList.contains('bilibili-player-active')) {
                            speedMenuListElement.click();
                        } else {
                            DefaultBehavior.video.setPlaybackRate(value);
                            $('.bilibili-player-video-btn-speed-name').textContent =
                                value === 1 ? '倍速' : `${value.toFixed(2).replace(/0$/, '')}x`;
                        }
                    }
                },
                play() { player.play(); },
                pause() { player.pause(); },
            }),
            integration: Object.assign({}, DefaultBehavior.integration, {
                toolbarElementSelector: '.video-toolbar .ops, #toolbar_module',
                panelParentElementSelector: '.bilibili-player-video-wrap',
                newSessionButtonElement: createElement('span', {
                    className: 'like-info',
                    onclick: newSession,
                    children: [
                        createElement('i', {
                            textContent: '⪘',
                        }),
                        createElement('span', {
                            textContent: '一起看',
                        }),
                    ],
                }),
            }),
            isReady() {
                return DefaultBehavior.isReady()
                    && unsafeWindow.player
                    && (url.searchParams.has('t') ? player.getState() === 'PLAYING' : true);
            },
            style: `
                .video-toolbar .ops .share {
                    width: 92px;
                }
                .bilibili-player-video-btn.disabled > * {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                #eplist_module.disabled ul {
                    cursor: not-allowed;
                }
                #eplist_module.disabled ul > li {
                    pointer-events: none;
                }
                .bilibili-player-video-btn.disabled > .bilibili-player-video-btn-menu-wrap,
                .bilibili-player-video-btn-speed.disabled > .bilibili-player-video-btn-speed-menu-wrap {
                    display: none;
                }
                #toolbar_module .mobile-info {
                    margin-right: 20px;
                }
            `,
        }),
        'www.youtube.com': Object.assign({}, DefaultBehavior, {
            video: {
                getId() { return new URL(location.href).searchParams.get('v'); },
                setId(value) {
                    const url = getShareableURL(serverURL, sessionId);
                    url.pathname = '/watch';
                    url.searchParams.set('v', value);
                    location.href = url.href;
                },
            },
        }),
    };

    // ==================
    // Core codes below.
    // ==================

    const site = unsafeWindow[Prefix] = SiteProfiles[location.host] || DefaultBehavior;
    const { profile, video, integration, style } = site;
    const knownPeers = new Map();
    const url = new URL(location.href);
    const serverURL = url.searchParams.get(`${Prefix}_url`);
    const sessionId = url.searchParams.get(`${Prefix}_session`);
    let ws = null;
    let wsURL = null;
    let id = null;
    let pushDisabled = false;
    let syncDisabled = false;

    // Entry point.
    GM_addStyle(DefaultBehavior.style);
    GM_addStyle(style);
    executeWhen(site.isReady.bind(site), main);

    const MessageHandlers = {
        handshake(msg) {
            id = msg.clientId;
            setPeerProfile({
                clientId: id,
                uid: profile.getSelfUID(),
            });
            queryPlayState();
        },
        query(msg) {
            push('queryResponse', msg.clientId);
        },
        queryResponse(msg) {
            sync(msg, { forced: true });
        },
        push(msg) {
            sync(msg, { forced: true });
            showFloatAvatar(msg.clientId);
            syncDisabled = true;
            timer.oneshot('enableSync', () => (syncDisabled = false), 1000);
        },
        keepAlive(msg) {
            sync(msg);
        },
    };

    function main() {
        setInterval(() => {
            if (location.href !== getShareableURL(serverURL, sessionId).href) {
                history.replaceState(null, '', getShareableURL(serverURL, sessionId).href);
            }
            if (isValidURL()) {
                integration.newSessionButtonElement.remove();
                if (!integration.panelElement.isConnected) {
                    $(integration.panelParentElementSelector).append(integration.panelElement);
                }
                hookPlayStateChange();
            } else {
                integration.panelElement.remove();
                if (!integration.newSessionButtonElement.isConnected) {
                    $(integration.toolbarElementSelector).append(integration.newSessionButtonElement);
                }
            }
        }, 500);

        if (isValidURL()) {
            const clientId = sessionStorage.getItem(`${Prefix}-clientIdOf-${sessionId}`);
            ws = new WebSocket(`${serverURL.replace('https', 'wss')}/session/${sessionId}/${clientId || ''}`);
            ws.onmessage = onMessage;
            ws.onerror = ws.onclose = onDisconnected;
            setInterval(() => push('keepAlive'), HeartbeatInterval);
            setInterval(purgeKnownPeers, 1000);
        }
    }

    function onMessage(event) {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'keepAlive' && msg.video && video.getId() !== msg.video) {
            sessionStorage.setItem(`${Prefix}-clientIdOf-${sessionId}`, id);
            video.setId(msg.video);
        }
        if (msg.uid !== undefined) {
            setPeerProfile(msg);
        }
        const handler = MessageHandlers[msg.type];
        if (handler) {
            handler(msg);
        }
    }
    function onDisconnected(event) {
        alert('Connection lost.');
        location.reload();
    }
    function hookPlayStateChange() {
        const videoElement = video.getBaseElement();
        if (!videoElement.dataset[`${Prefix}ListenerAttached`]) {
            videoElement.addEventListener('pause', video.onpause);
            videoElement.addEventListener('play', video.onplay);
            videoElement.addEventListener('seeking', video.onseeking);
            videoElement.addEventListener('ratechange', video.onratechange);
            videoElement.addEventListener('pause', () => push());
            videoElement.addEventListener('play', () => push());
            videoElement.addEventListener('seeking', () => push());
            videoElement.addEventListener('ratechange', () => push());
            videoElement.dataset[`${Prefix}ListenerAttached`] = 'true';
        }
    }
    function queryPlayState() {
        ws.send(JSON.stringify({
            type: 'query',
            clientId: id,
            uid: profile.getSelfUID(),
        }));
    }
    function sync(remote, options) {
        options = options || {};
        if (syncDisabled && remote.type === 'keepAlive') {
            return;
        }
        if (remote.type === 'push') {
            pushDisabled = true;
            setTimeout(() => (pushDisabled = false), 100);
        }
        video.setPaused(remote.paused);
        video.setPlaybackRate(remote.playbackRate);
        if (options.forced || Math.abs(remote.currentTime - video.getCurrentTime()) * 1000 > DeviationThreshold) {
            video.setCurrentTime(remote.currentTime);
        }
    }
    function push(type, recipient) {
        if (!pushDisabled && video.getCurrentTime() < video.getDuration() - 1) {
            ws.send(JSON.stringify({
                recipient,
                type: type || 'push',
                clientId: id,
                uid: profile.getSelfUID(),
                paused: video.getPaused(),
                currentTime: video.getCurrentTime(),
                playbackRate: video.getPlaybackRate(),
                video: video.getId(),
            }));
            syncDisabled = true;
            timer.oneshot('enableSync', () => (syncDisabled = false), 1000);
        }
    }
    function newSession() {
        let serverURL = prompt('Server URL:', GM_getValue('url', 'https://example.com/'));
        if (serverURL) {
            serverURL = serverURL.replace(/^((https?:)?\/\/)?/, 'https://');
            GM_setValue('url', serverURL);
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${serverURL}/session`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({
                    playerUrl: location.href,
                }),
                onload: function (response) {
                    if (response.status == 200) {
                        GM_notification({
                            text: 'The share link has been copied to the clipboard.',
                            title: `${Prefix} - ${location.host}`,
                            highlight: true,
                            timeout: 10000,
                        });
                        const sessionId = JSON.parse(response.responseText).sessionId;
                        const url = getShareableURL(serverURL, sessionId);
                        navigator.clipboard.writeText(url.href);
                        location.href = url.href;
                    }
                    else {
                        alert('Unable to connect to the server.');
                    }
                },
            });
        }
    }
    function setPeerProfile(msg) {
        if (!knownPeers.has(msg.clientId)) {
            knownPeers.set(msg.clientId, { uid: msg.uid });
            Promise.all([
                profile.getNickname(msg.uid),
                profile.getAvatarURL(msg.uid),
            ]).then(results => {
                const peer = knownPeers.get(msg.clientId);
                peer.nickname = results[0];
                peer.avatarURL = results[1];
                if (msg.type && msg.type !== 'queryResponse') {
                    GM_notification({
                        text: `${peer.nickname} entered.`,
                        title: `${Prefix} - ${location.host}`,
                        image: peer.avatarURL,
                        highlight: true,
                        timeout: 5000,
                    });
                }
                renderPeersPanel();
            });
        }
        knownPeers.get(msg.clientId).lastActiveTime = Date.now();
    }
    function purgeKnownPeers() {
        for (const [clientId, peer] of knownPeers) {
            if (clientId != id && Date.now() - peer.lastActiveTime > PeerPurgeTimeout) {
                GM_notification({
                    text: `${peer.nickname} left.`,
                    title: `${Prefix} - ${location.host}`,
                    image: peer.avatarURL,
                    highlight: true,
                    timeout: 5000,
                });
                knownPeers.delete(clientId);
                renderPeersPanel();
            }
        }
    }
    function renderPeersPanel() {
        const peersPanel = $(`${Prefix}-peer-panel`);
        peersPanel.textContent = '';
        for (const [clientId, peer] of knownPeers) {
            peersPanel.append(integration.getPeerElement(peer));
        }
    }
    function showFloatAvatar(clientId) {
        const peer = knownPeers.get(clientId);
        if (peer) {
            integration.floatAvatarElement.src = peer.avatarURL;
            integration.floatAvatarElement.classList.add('show');
            timer.oneshot('hideFloatAvatar', () => {
                integration.floatAvatarElement.classList.remove('show');
            }, FloatAvatarShowTime);
        }
    }

    function isValidURL() { return url.searchParams.has(`${Prefix}_url`) && url.searchParams.has(`${Prefix}_session`); }
    function getShareableURL(serverURL, sessionId) {
        const url = new URL(location.href);
        if (serverURL && sessionId) {
            url.searchParams.set(`${Prefix}_url`, serverURL);
            url.searchParams.set(`${Prefix}_session`, sessionId);
            url.searchParams.set('t', '0.01');
        } else {
            url.searchParams.delete(`${Prefix}_url`);
            url.searchParams.delete(`${Prefix}_session`);
        }
        return url;
    }

    // Utility functions.
    function $(selector) { return document.querySelector(selector); }
    function createElement(type, args) {
        var element = document.createElement(type);
        for (var prop in args) {
            var arg = args[prop];
            if (prop === 'classList' && arg instanceof Array) {
                element.classList.add(...arg);
            } else if (prop === 'children' && arg instanceof Array) {
                element.append(...arg);
            } else if (prop === 'styles' && arg instanceof Object) {
                Object.assign(element.style, arg);
            } else if (prop.startsWith('attr_')) {
                element.setAttribute(prop.substring(5), arg);
            } else if (prop.startsWith('on')) {
                element.addEventListener(prop.substring(2), arg);
            } else {
                element[prop] = arg;
            }
        }
        return element;
    }
    function executeWhen(predicate, callback, interval) {
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                callback();
            }
        }, interval || 100);
    }
    const timer = (function () {
        this.timers = {};
        this.oneshot = function (id, callback, interval) {
            clearTimeout(this.timers[id]);
            clearInterval(this.timers[id]);
            this.timers[id] = setTimeout(callback, interval);
        };
        this.periodic = function (id, callback, interval) {
            clearTimeout(this.timers[id]);
            clearInterval(this.timers[id]);
            this.timers[id] = setInterval(callback, interval);
        };
    })();
})();
