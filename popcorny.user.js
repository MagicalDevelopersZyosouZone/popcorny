// ==UserScript==
// @name         popcorny
// @namespace    studio.mdzz
// @version      0.2.0
// @description  Watch videos together.
// @author       Dwscdv3
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @license      GPL-3.0-or-later
// @updateURL    https://github.com/MagicalDevelopersZyosouZone/popcorny/raw/main/popcorny.user.js
// @downloadURL  https://github.com/MagicalDevelopersZyosouZone/popcorny/raw/main/popcorny.user.js
// @homepageURL  https://dwscdv3.com/
// @supportURL   https://github.com/MagicalDevelopersZyosouZone/popcorny/issues
// ==/UserScript==

/* global
 *   player
 */

(function() {
    'use strict';

    const Prefix = 'popcorny';
    const DeviationThreshold = 5000;
    const PeerPurgeTimeout = 15000;

    const DefaultBehavior = {
        profile: {
            getSelfUID: () => null,
            getNickname: uid => Promise.resolve('Guest'),
            getAvatarURL: uid => Promise.resolve(null),
        },
        video: {
            videoElementSelector: 'video',
            getBaseElement() { return $(this.videoElementSelector); },
            getPaused() { return this.getBaseElement().paused; },
            setPaused(value) { value ? this.getBaseElement().pause() : this.getBaseElement().play(); },
            getCurrentTime() { return this.getBaseElement().currentTime; },
            setCurrentTime(value) { this.getBaseElement().curreentTime = value; },
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
            newSessionButtonElement: createElement('button', { textContent: '新建放映室' }),
            panelParentElementSelector: 'body',
            panelElement: createElement(`${Prefix}-panel`, {
                children: [
                    createElement(`${Prefix}-panel-header`, {
                        textContent: '⪘',
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
                    .then(responseBody => responseBody.data.card.face),
            }),
            video: Object.assign({}, DefaultBehavior.video, {
                videoElementSelector: '.bilibili-player-video video',
                getPaused() { return player.getState() !== 'PLAYING'; },
                setPaused(value) { value ? player.pause() : player.play(); },
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
                newSessionButtonElement: createElement('span', {
                    className: 'like-info',
                    children: [
                        createElement('i', {
                            textContent: '⪘',
                        }),
                        createElement('span', {
                            textContent: '一起看',
                        }),
                    ],
                }),
                panelParentElementSelector: '.bilibili-player-video-wrap',
            }),
            isReady() {
                return DefaultBehavior.isReady()
                    && unsafeWindow.player
                    && (query.has('t') ? player.getState() === 'PLAYING' : true);
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
    };
    const site = unsafeWindow[Prefix] = SiteProfiles[location.hostname] || DefaultBehavior;
    const { profile, video, integration, style } = site;
    GM_addStyle(DefaultBehavior.style);
    GM_addStyle(style);

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
        },
        keepAlive(msg) {
            sync(msg);
        },
    };

    let ws = null;
    let serverURL = null;
    let id = null;
    let pushDisabled = false;
    let keepAliveTimer = null;
    let purgeKnownPeersTimer = null;
    const knownPeers = new Map();

    const query = new URLSearchParams(location.search);
    if (!query.has(`${Prefix}_url`)) {
        executeWhen(site.isReady, () => {
            integration.newSessionButtonElement.addEventListener('click', newSession);
            $(integration.toolbarElementSelector).appendChild(integration.newSessionButtonElement);
        });
    } else {
        executeWhen(site.isReady, () => {
            $(integration.panelParentElementSelector).appendChild(integration.panelElement);

            serverURL = `${query.get(`${Prefix}_url`)}/session/${query.get(`${Prefix}_session`)}`.replace('https', 'wss');
            ws = new WebSocket(serverURL);
            ws.onmessage = function (e) {
                const msg = JSON.parse(e.data);
                if (msg.uid !== undefined) {
                    setPeerProfile(msg);
                }
                const handler = MessageHandlers[msg.type];
                if (handler) {
                    handler(msg);
                }
            };
            ws.onerror = function (e) {
                alert('Connection lost.');
                location.reload();
            };
            keepAliveTimer = setInterval(() => push('keepAlive'), 5000);
            setTimeout(hookPlayStateChange, 0);
            const purgeKnownPeersTimer = setInterval(purgeKnownPeers, 1000);
        });
    }

    function hookPlayStateChange() {
        const videoElement = video.getBaseElement();
        videoElement.addEventListener('pause', video.onpause);
        videoElement.addEventListener('play', video.onplay);
        videoElement.addEventListener('seeking', video.onseeking);
        videoElement.addEventListener('ratechange', video.onratechange);
        videoElement.addEventListener('pause', () => push());
        videoElement.addEventListener('play', () => push());
        videoElement.addEventListener('seeking', () => push());
        videoElement.addEventListener('ratechange', () => push());
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
        pushDisabled = true;
        video.setPaused(remote.paused);
        video.setPlaybackRate(remote.playbackRate);
        if (options.forced || Math.abs(remote.currentTime - video.getCurrentTime()) > DeviationThreshold) {
            video.setCurrentTime(remote.currentTime);
        }
        setTimeout(() => (pushDisabled = false), 100);
    }
    function push(type, recipient) {
        if (!pushDisabled) {
            ws.send(JSON.stringify({
                recipient,
                type: type || 'push',
                clientId: id,
                uid: profile.getSelfUID(),
                paused: video.getPaused(),
                currentTime: video.getCurrentTime(),
                playbackRate: video.getPlaybackRate(),
            }));
        }
    }
    function newSession() {
        let url = prompt('Server URL:', GM_getValue('url', 'https://example.com/'));
        if (url) {
            url = url.replace(/^((https?:)?\/\/)?/, 'https://');
            GM_setValue('url', url);
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${url}/session`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({
                    playerUrl: location.href,
                }),
                onload: function (response) {
                    if (response.status == 200) {
                        const sessionId = JSON.parse(response.responseText).sessionId;
                        query.set(`${Prefix}_url`, url);
                        query.set(`${Prefix}_session`, sessionId);
                        query.set('t', '0.01');
                        location.search = query.toString();
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
                renderPeersPanel();
            });
        }
        knownPeers.get(msg.clientId).lastActiveTime = Date.now();
    }
    function purgeKnownPeers() {
        for (const [clientId, peer] of knownPeers) {
            if (clientId != id && Date.now() - peer.lastActiveTime > PeerPurgeTimeout) {
                knownPeers.delete(clientId);
                renderPeersPanel();
            }
        }
    }
    function renderPeersPanel() {
        const peersPanel = $(`${Prefix}-peer-panel`);
        peersPanel.textContent = '';
        for (const [clientId, peer] of knownPeers) {
            peersPanel.appendChild(integration.getPeerElement(peer));
        }
    }

    /* Utility functions */
    function $(selector) { return document.querySelector(selector); }
    function createElement(type, args) {
        var element = document.createElement(type);
        for (var prop in args) {
            var arg = args[prop];
            if (prop === 'classList' && arg instanceof Array) {
                arg.forEach(function (cls) {
                    if (typeof cls === 'string') {
                        element.classList.add(cls);
                    }
                });
            } else if (prop === 'children' && arg instanceof Array) {
                arg.forEach(function (child) {
                    if (child instanceof Node) {
                        element.appendChild(child);
                    } else if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    }
                });
            } else if (prop === 'styles' && arg instanceof Object) {
                for (var name in arg) {
                    element.style[name] = arg[name];
                }
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
})();
