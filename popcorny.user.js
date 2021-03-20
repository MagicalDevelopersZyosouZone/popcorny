// ==UserScript==
// @name         popcorny
// @namespace    studio.mdzz
// @version      0.4.0
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

    // Public constants.
    const ProductName = 'popcorny';
    const FloatAvatarShowTime = 4000;
    const DeviationThreshold = 5000;
    const HeartbeatInterval = 5000; // Shouldn't higher than PeerPurgeTimeout. Lower value may result in sync problems.
    const PeerPurgeTimeout = 15000;

    // Internal constants. (Must be same across peers.)
    const GuestPrefix = 'Guest_';

    let _ = {}; // A trash bin to store temporary variables from object initializers.

    // You can add support by add site specific code to `SiteProfiles`.
    // A site object will be deep merged with `Default`. see profile 'www.bilibili.com' for example.
    const SiteProfiles = {
        'www.bilibili.com': {
            session: {
                getShareURL(serverURL = server.url, sessionId = this.id) {
                    const url = Default.session.getShareURL(serverURL, sessionId);
                    if (url.searchParams.has(`${ProductName}_session`)) {
                        url.searchParams.set('t', '0.01');
                    } else if (url.searchParams.get(`t`) === '0.01') {
                        url.searchParams.delete('t');
                    }
                    return url;
                },
            },
            profile: {
                getSelfUID() {
                    return $('.vp-container .counts a')
                      ? 'bili_' + $('.vp-container .counts a').href.match(/\d+/)[0]
                      : Default.profile.getSelfUID();
                },
                async getNickname(uid = this.getSelfUID()) {
                    return uid.startsWith('bili_')
                      ? (await (await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${uid.substring(5)}`)).json())
                        .data.card.name
                      : Default.profile.getNickname(uid);
                },
                async getAvatarURL(uid = this.getSelfUID()) {
                    return uid.startsWith('bili_')
                      ? (await (await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${uid.substring(5)}`)).json())
                        .data.card.face.replace(/^((https?:)?\/\/)?/, 'https://')
                      : 'https://static.hdslb.com/images/member/noface.gif';
                },
            },
            video: {
                videoElementSelector: '.bilibili-player-video video',
                getId() { return `${location.pathname},${new URL(location.href).searchParams.get('p') || '1'}`; },
                setId(value) {
                    const [pathname, part] = value.split(',');
                    const url = session.getShareURL();
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
                            Default.video.setPlaybackRate(value);
                            $('.bilibili-player-video-btn-speed-name').textContent =
                                value === 1 ? '倍速' : `${value.toFixed(2).replace(/0$/, '')}x`;
                        }
                    }
                },
            },
            UI: {
                toolbarElementSelector: '.video-toolbar .ops, #toolbar_module',
                panelParentElementSelector: '.bilibili-player-video-wrap',
                createSessionButtonElement: createElement('span', {
                    className: 'like-info',
                    onclick(event) {
                        session.create();
                    },
                    children: [
                        createElement('i', {
                            textContent: '⪘',
                        }),
                        createElement('span', {
                            textContent: '一起看',
                        }),
                    ],
                }),
            },
            isReady() {
                return Default.isReady()
                    && unsafeWindow.player
                    && (new URL(location).searchParams.has('t') === '0.01' ? player.getState() === 'PLAYING' : true);
            },
            style: `...`,
        },
        'www.youtube.com': {
            video: {
                getId() { return new URL(location.href).searchParams.get('v'); },
                setId(value) {
                    const url = session.getShareURL();
                    url.pathname = '/watch';
                    url.searchParams.set('v', value);
                    location.href = url.href;
                },
            },
            UI: {
                panelParentElementSelector: '.html5-video-player',
            },
        },
    };

    const Default = {
        server: {
            url: new URL(location).searchParams.get(`${ProductName}_url`),
            clientId: sessionStorage.getItem(`${ProductName}-clientIdOf-${session.id}`),
            ws: null,
            peers: new Map(),
            pushDisabled: false,
            handlers: {
                handshake(msg) {
                    server.clientId = msg.clientId;
                    server.addPeer({
                        clientId: server.clientId,
                        uid: profile.getSelfUID(),
                    });
                    server.peers.self = server.peers.get(server.clientId);
                    server.send({
                        type: 'query',
                        uid: profile.getSelfUID(),
                    });
                },
                query(msg) {
                    server.pushState('queryResponse', msg.clientId);
                },
                queryResponse(msg) {
                   video.sync(msg, { forced: true });
                },
                push(msg) {
                    video.sync(msg, { forced: true });
                    UI.showFloatAvatar(msg.clientId);
                    video.syncDisabled = true;
                    timer.oneshot('enableSync', () => (video.syncDisabled = false), 1000);
                },
                keepAlive(msg) {
                    video.sync(msg);
                },
                chat(msg) {
                    let shouldScrollToBottom = false;
                    const scrollView = UI.chatPanelElement.querySelector(`${ProductName}-panel-body-inner`);
                    if (scrollView.scrollTop + scrollView.clientHeight + 5 >= scrollView.scrollHeight) {
                        shouldScrollToBottom = true;
                    }
                    chat.appendChatLog(msg.clientId, msg.content);
                    if (shouldScrollToBottom) {
                        scrollView.scrollTo({
                            top: scrollView.scrollHeight,
                            behavior: 'smooth',
                        });
                    }
                },
            },
            connect() {
                this.ws = new WebSocket(`${this.url.replace('https', 'wss')}/session/${session.id}/${this.clientId || ''}`);
                this.ws.onmessage = this.onmessage;
                this.ws.onclose = this.onclose;
            },
            isConnected() {
                return this.ws && this.ws.readyState === 1;
            },
            onmessage(event) {
                const msg = JSON.parse(event.data);
                if (msg.type !== 'keepAlive' && msg.video && video.getId() !== msg.video) {
                    sessionStorage.setItem(`${ProductName}-clientIdOf-${session.id}`, this.clientId);
                    video.setId(msg.video);
                }
                if (msg.uid !== undefined) {
                    this.addPeer(msg);
                }
                const handler = this.handlers[msg.type];
                if (handler) {
                    handler(msg);
                }
            },
            onclose(event) {
                if (event.code === 1000) {
                    alert(event.reason);
                    location.href = session.getShareURL(null, null);
                } else {
                    alert('Connection lost.');
                    this.connect();
                }
            },
            send(obj) {
                this.ws.send(JSON.stringify(from(obj, { clientId: this.clientId })));
            },
            pushState(type = 'push', recipient) {
                if (!this.pushDisabled && video.getCurrentTime() < video.getDuration() - 1) {
                    this.send({
                        recipient,
                        type,
                        uid: profile.getSelfUID(),
                        paused: video.getPaused(),
                        currentTime: video.getCurrentTime(),
                        playbackRate: video.getPlaybackRate(),
                        video: video.getId(),
                    });
                    video.syncDisabled = true;
                    timer.oneshot('enableSync', () => (video.syncDisabled = false), 1000);
                }
            },
            sendChatMessage(content) {
                this.send({
                    type: 'chat',
                    content: content.trim(),
                });
            },
            async addPeer(msg) {
                if (!this.peers.has(msg.clientId) || this.peers.get(msg.clientId).disconnected) {
                    this.peers.set(msg.clientId, { uid: msg.uid });
                    const results = await Promise.all([
                        profile.getNickname(msg.uid),
                        profile.getAvatarURL(msg.uid),
                    ]);
                    const peer = this.peers.get(msg.clientId);
                    peer.clientId = msg.clientId;
                    peer.nickname = results[0];
                    peer.avatarURL = results[1];
                    peer.disconnected = false;
                    if (msg.type && msg.type !== 'queryResponse') {
                        GM_notification({
                            text: `${peer.nickname} entered.`,
                            title: `${ProductName} - ${location.host}`,
                            image: peer.avatarURL,
                            highlight: true,
                            timeout: 5000,
                        });
                    }
                    UI.renderPeersPanel();
                }
                this.peers.get(msg.clientId).lastActiveTime = Date.now();
            },
            markDisconnectedPeers() {
                for (const [peerClientId, peer] of this.peers) {
                    if (!peer.disconnected && peerClientId != this.clientId && Date.now() - peer.lastActiveTime > PeerPurgeTimeout) {
                        GM_notification({
                            text: `${peer.nickname} left.`,
                            title: `${ProductName} - ${location.host}`,
                            image: peer.avatarURL,
                            highlight: true,
                            timeout: 5000,
                        });
                        peer.disconnected = true;
                        UI.renderPeersPanel();
                    }
                }
            },
        },
        session: {
            id: new URL(location).searchParams.get(`${ProductName}_session`),
            isValidURL() {
                return new URL(location).searchParams.has(`${ProductName}_url`) && new URL(location).searchParams.has(`${ProductName}_session`);
            },
            create() {
                server.url = prompt('Server URL:', GM_getValue('url', 'https://example.com/'));
                if (server.url) {
                    server.url = server.url.replace(/^((https?:)?\/\/)?/, 'https://');
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: `${server.url}/session`,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        data: JSON.stringify({
                            playerUrl: location.href,
                        }),
                        onload: response => {
                            if (response.status == 200) {
                                GM_setValue('url', server.url);
                                GM_notification({
                                    text: 'The share link has been copied to the clipboard.',
                                    title: `${ProductName} - ${location.host}`,
                                    highlight: true,
                                    timeout: 10000,
                                });
                                this.id = JSON.parse(response.responseText).sessionId;
                                const url = this.getShareURL();
                                navigator.clipboard.writeText(url.href);
                                location.href = url.href;
                            }
                            else {
                                alert('Unable to connect to the server.');
                            }
                        },
                    });
                }
            },
            getShareURL(serverURL = server.url, sessionId = this.id) {
                const url = new URL(location);
                if (serverURL && sessionId) {
                    url.searchParams.set(`${ProductName}_url`, serverURL);
                    url.searchParams.set(`${ProductName}_session`, sessionId);
                } else {
                    url.searchParams.delete(`${ProductName}_url`);
                    url.searchParams.delete(`${ProductName}_session`);
                }
                return url;
            },
            correctAddress() {
                if (location.href !== this.getShareURL().href) {
                    history.replaceState(null, '', this.getShareURL().href);
                }
            },
        },
        chat: {
            lastMessageClientId: null,
            logs: [],
            appendChatLog(clientId, content) {
                const peer = server.peers.get(clientId);
                this.logs.push({
                    peer,
                    content,
                    time: video.getCurrentTime(),
                });
                if (this.lastMessageClientId === peer.clientId) {
                    UI.lastMessageChainElement.append(UI.createChatLogBubbleElement(peer, content));
                } else {
                    const chatLogElement = UI.createChatLogElement(peer, content);
                    UI.chatListElement.append(chatLogElement);
                    this.lastMessageClientId = peer.clientId;
                    UI.lastMessageChainElement = chatLogElement.querySelector(`${ProductName}-chat-log-inner`);
                }
            },
            saveChatLog() {
                if (chat.logs.length > 0) {
                    saveTextToFile(
                        `${ProductName}-chatlog-${video.getId().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '-')}.tsv`,
                        chat.logs.reduce(
                            (acc, next) => (acc += `${parseInt(next.time)}\t${next.peer.nickname}\t${next.content.trim().replace(/\s+/g, ' ')}\n`),
                            'Time\tNickname\tContent\n',
                        ),
                    );
                }
            },
        },
        profile: {
            getSelfUID() {
                return `${GuestPrefix}${server.clientId.substring(0, 4)}_${GM_getValue('nickname') || ''}`;
            },
            getNickname(uid = this.getSelfUID()) {
                return Promise.resolve(uid.match(`(?<=${GuestPrefix}.{4}_).*`)[0] || uid.replace(/_/g, ' ').trim());
            },
            getAvatarURL(uid = this.getSelfUID()) {
                return Promise.resolve(`data:image/svg+xml,
                    %3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600' stroke='white' stroke-width='30' fill='none'%3E
                    %3Ccircle cx='300' cy='300' r='265'/%3E
                    %3Ccircle cx='300' cy='230' r='115'/%3E
                    %3Cpath d='M106,481 a205,205 1 0,1 386,0'/%3E
                    %3C/svg%3E`); // Default user icon
            },
            isGuest(uid = this.getSelfUID()) {
                return uid.startsWith(GuestPrefix);
            },
        },
        video: {
            syncDisabled: false,
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
            play() { this.setPaused(false); },
            pause() { this.setPaused(true); },
            onpause(event) {},
            onplay(event) {},
            onseeking(event) {},
            onratechange(event) {},
            hookEvents() {
                const videoElement = this.getBaseElement();
                if (!videoElement.dataset[`${ProductName}ListenerAttached`]) {
                    videoElement.addEventListener('pause', this.onpause);
                    videoElement.addEventListener('play', this.onplay);
                    videoElement.addEventListener('seeking', this.onseeking);
                    videoElement.addEventListener('ratechange', this.onratechange);
                    videoElement.addEventListener('pause', () => server.pushState());
                    videoElement.addEventListener('play', () => server.pushState());
                    videoElement.addEventListener('seeking', () => server.pushState());
                    videoElement.addEventListener('ratechange', () => server.pushState());
                    videoElement.dataset[`${ProductName}ListenerAttached`] = 'true';
                }
            },
            sync(remote, options = {}) {
                if (video.syncDisabled && remote.type === 'keepAlive') {
                    return;
                }
                if (remote.type === 'push') {
                    server.pushDisabled = true;
                    setTimeout(() => (server.pushDisabled = false), 100);
                }
                this.setPaused(remote.paused);
                this.setPlaybackRate(remote.playbackRate);
                if (options.forced || Math.abs(remote.currentTime - this.getCurrentTime()) * 1000 > DeviationThreshold) {
                    this.setCurrentTime(remote.currentTime);
                }
            },
        },
        UI: {
            lastMessageChainElement: null,
            toolbarElementSelector: 'body',
            panelParentElementSelector: 'body',
            createSessionButtonElement: createElement('button', {
                className: `${ProductName}-create-session-button`,
                textContent: 'Watch Together',
                onclick(event) {
                    session.create();
                },
            }),
            floatAvatarElement: _.floatAvatarElement = createElement('img', {
                className: `${ProductName}-avatar`,
            }),
            peerListElement: _.peerListElement = createElement(`${ProductName}-peer-list`),
            chatListElement: _.chatListElement = createElement(`${ProductName}-chat-list`),
            editNicknameButtonElement: createElement(`${ProductName}-edit-nickname-button`, {
                textContent: '✎',
                title: 'Edit nickname',
                async onclick() {
                    const nickname = prompt('Your new nickname (leave empty to use random ID):', GM_getValue('nickname'));
                    if (nickname != null) {
                        GM_setValue('nickname', nickname);
                        location.reload();
                    }
                },
            }),
            chatInputElement: _.chatInputElement = createElement('input', {
                type: 'text',
                placeholder: 'Write a message...',
                onkeydown(event) {
                    if (event.key === 'Enter') {
                        UI.chatSendButtonElement.click();
                    }
                },
                onfocus(event) {
                    UI.chatPanelElement.classList.add('show');
                },
                onblur(event) {
                    UI.chatPanelElement.classList.remove('show');
                },
            }),
            chatSendButtonElement: _.chatSendButtonElement = createElement(`${ProductName}-chat-send-button`, {
                onclick(event) {
                    const content = UI.chatInputElement.value;
                    if (content.trim().length > 0) {
                        UI.chatInputElement.value = '';
                        UI.chatInputElement.focus();
                        server.sendChatMessage(content);
                        chat.appendChatLog(server.clientId, content);
                        const scrollView = UI.chatPanelElement.querySelector(`${ProductName}-panel-body-inner`);
                        scrollView.scrollTo({
                            top: scrollView.scrollHeight,
                            behavior: 'smooth',
                        });
                    }
                },
            }),
            peerPanelElement: _.peerPanelElement = createElement(`${ProductName}-peer-panel`, {
                classList: [`${ProductName}-panel`],
                children: [
                    createElement(`${ProductName}-panel-header`, {
                        children: [
                            '👥',
                            _.floatAvatarElement,
                        ],
                    }),
                    createElement(`${ProductName}-panel-body`, {
                        children: [
                            createElement(`${ProductName}-panel-title`, { textContent: 'Peers' }),
                            createElement(`${ProductName}-panel-body-inner`, {
                                children: [
                                    _.peerListElement,
                                ],
                            }),
                        ],
                    }),
                ],
            }),
            chatPanelElement: _.chatPanelElement = createElement(`${ProductName}-chat-panel`, {
                classList: [`${ProductName}-panel`],
                children: [
                    createElement(`${ProductName}-panel-header`, {
                        textContent: '💬',
                    }),
                    createElement(`${ProductName}-panel-body`, {
                        children: [
                            createElement(`${ProductName}-panel-title`, { textContent: 'Chat' }),
                            createElement(`${ProductName}-panel-body-inner`, {
                                children: [
                                    _.chatListElement,
                                ],
                            }),
                            createElement(`${ProductName}-chat-input-box`, {
                                children: [
                                    _.chatInputElement,
                                    _.chatSendButtonElement,
                                ],
                            }),
                        ],
                    }),
                ],
            }),
            rootElement: createElement(ProductName, {
                children: [
                    _.chatPanelElement,
                    _.peerPanelElement,
                ],
            }),
            createPeerElement(peer) {
                return createElement(`${ProductName}-peer`, {
                    children: [
                        createElement('img', {
                            className: `${ProductName}-avatar`,
                            src: peer.avatarURL,
                        }),
                        createElement(`${ProductName}-peer-nickname`, {
                            textContent: peer.nickname,
                        }),
                    ],
                });
            },
            renderPeersPanel() {
                this.peerListElement.textContent = '';
                for (const [peerClientId, peer] of server.peers) {
                    if (!peer.disconnected) {
                        const peerElement = this.createPeerElement(peer);
                        this.peerListElement.append(peerElement);
                        if (peerClientId == server.clientId && profile.isGuest()) {
                            peerElement.append(this.editNicknameButtonElement);
                        }
                    }
                }
            },
            createChatLogBubbleElement(peer, content) {
                return createElement(`${ProductName}-chat-log-bubble`, {
                    textContent: content,
                    styles: {
                        backgroundColor: this.getBubbleColor(peer),
                    },
                });
            },
            createChatLogElement(peer, content) {
                return createElement(`${ProductName}-chat-log`, {
                    className: peer.clientId === server.clientId ? 'outgoing' : '',
                    children: [
                        createElement('img', {
                            className: `${ProductName}-avatar`,
                            src: peer.avatarURL,
                        }),
                        createElement(`${ProductName}-chat-log-inner`, {
                            children: [
                                createElement(`${ProductName}-chat-log-nickname`, {
                                    textContent: peer.nickname,
                                }),
                                createElement(`${ProductName}-chat-log-bubble-pointer`, {
                                    styles: {
                                        borderColor: `transparent ${this.getBubbleColor(peer)} transparent transparent`,
                                    },
                                }),
                                this.createChatLogBubbleElement(peer, content),
                            ],
                        }),
                    ],
                });
            },
            getBubbleColor(peer) {
                return `hsl(${getStringHashCode(peer.clientId) % 360}, 100%, 90%)`;
            },
            injectElement() {
                if (session.isValidURL()) {
                    this.createSessionButtonElement.remove();
                    if (!this.rootElement.isConnected) {
                        $(this.panelParentElementSelector).append(this.rootElement);
                    }
                } else {
                    this.rootElement.remove();
                    if (!this.createSessionButtonElement.isConnected) {
                        $(this.toolbarElementSelector).append(this.createSessionButtonElement);
                    }
                }
            },
            showFloatAvatar(clientId, time = FloatAvatarShowTime) {
                const peer = server.peers.get(clientId);
                if (peer) {
                    this.floatAvatarElement.src = peer.avatarURL;
                    this.floatAvatarElement.classList.add('show');
                    timer.oneshot('hideFloatAvatar', () => {
                        this.floatAvatarElement.classList.remove('show');
                    }, time);
                }
            },
        },
        isReady() {
            return $(this.video.videoElementSelector) && $(this.video.videoElementSelector).duration > 0;
        },
    };

    /* Global style, this unnecessary block scope is for code editor folding */ {
        const _ = GM_addStyle(`
.${ProductName}-create-session-button {
    position: fixed;
    right: 20px;
    bottom: 20px;
}
.${ProductName}-panel {
    --icon-size: 36px;
    --panel-round: calc(var(--icon-size) / 2);
    display: block;
    position: absolute;
    top: 60px;
    right: 20px;
    bottom: 60px;
    font-size: 13px;
    z-index: 1900;
}
.${ProductName}-panel:nth-child(2) {
    top: 108px;
    z-index: 1800;
}
${ProductName}-panel-header {
    display: block;
    position: absolute;
    right: 0;
    width: var(--icon-size);
    height: var(--icon-size);
    border-radius: var(--panel-round);
    color: white;
    background-color: rgba(255, 255, 255, 0);
    font-family: 'Segoe UI Symbol';
    font-size: 21px;
    line-height: var(--icon-size);
    text-align: center;
    box-shadow: 0 0 0 black;
    backdrop-filter: blur(5px) brightness(0.75);
    transition: all 0.2s;
    z-index: 1901;
}
${ProductName}-panel-header .${ProductName}-avatar {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.5s;
    pointer-events: none;
}
${ProductName}-panel-header .${ProductName}-avatar.show {
    opacity: 1;
}
.${ProductName}-panel.show ${ProductName}-panel-header,
.${ProductName}-panel:hover ${ProductName}-panel-header {
    color: black;
    background-color: white;
    box-shadow: 1px 1px 5px black;
}
${ProductName}-panel-body {
    display: block;
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 240px;
    max-height: 400px;
    border-radius: var(--panel-round);
    visibility: collapse;
    opacity: 0;
    color: white;
    background-color: #ffffff1f;
    box-shadow: 0 0 0.8em white;
    text-shadow: 1px 1px 2px black;
    backdrop-filter: blur(5px) brightness(0.7);
    transition: all 0.2s;
}
.${ProductName}-panel.show ${ProductName}-panel-body,
.${ProductName}-panel:hover ${ProductName}-panel-body {
    visibility: visible;
    opacity: 1;
}
${ProductName}-panel-body-inner {
    display: block;
    position: relative;
    height: 100%;
    padding: 3em 1em 1em;
    box-sizing: border-box;
    overflow-y: auto;
    -webkit-mask: linear-gradient(
        to bottom,
        transparent,
        #0003 2.5em,
        black 4em,
        black calc(100% - 2.5em),
        transparent 100%);
    mask: linear-gradient(
        to bottom,
        transparent,
        #0003 2.5em,
        black 4em,
        black calc(100% - 2.5em),
        transparent 100%);
}
${ProductName}-peer-list {
    display: block;
}
${ProductName}-panel-title {
    display: block;
    position: absolute;
    padding: 0.6em;
    font-family: sans-serif;
    font-size: 175%;
    font-weight: 300;
}
${ProductName}-peer {
    display: flex;
    margin: 1em 0.5em;
    align-items: center;
    line-height: 24px;
}
${ProductName}-edit-nickname-button {
    width: 24px;
    height: 24px;
    margin-left: 0.5em;
    line-height: 24px;
    border-radius: 12px;
    opacity: 0.8;
    background-color: transparent;
    text-align: center;
    transform: scaleX(-1);
}
${ProductName}-edit-nickname-button:hover {
    background-color: #fff6;
}
${ProductName}-edit-nickname-button:active {
    background-color: #0006;
}
.${ProductName}-avatar {
    width: 24px;
    height: 24px;
    border-radius: 1000px;
    object-fit: cover;
}
${ProductName}-panel-body .${ProductName}-avatar {
    margin-right: 0.5em;
}
${ProductName}-chat-panel ${ProductName}-panel-body-inner {
    -webkit-mask: linear-gradient(
        to bottom,
        transparent,
        #0003 2.5em,
        black 4em,
        black calc(100% - var(--icon-size) - 1.5em),
        #0003 calc(100% - var(--icon-size)),
        transparent 100%);
    mask: linear-gradient(
        to bottom,
        transparent,
        #0003 2.5em,
        black 4em,
        black calc(100% - var(--icon-size) - 1.5em),
        #0003 calc(100% - var(--icon-size)),
        transparent 100%);
}
${ProductName}-chat-list {
    display: block;
    padding-bottom: calc(var(--icon-size) - 1em);
}
${ProductName}-chat-log {
    display: flex;
    position: relative;
    margin: 1em 0;
}
${ProductName}-chat-log .${ProductName}-avatar {
    position: sticky;
    top: 1em;
}
${ProductName}-chat-log-nickname {
    display: block;
    margin-bottom: 0.2rem;
    opacity: 0.9;
    font-size: 12px;
}
${ProductName}-chat-log-bubble {
    --round: 0.6rem;
    display: block;
    position: relative;
    width: fit-content;
    margin: 0.2rem 0.5em 0 0.6rem;
    padding: 0.5em;
    border-radius: var(--round);
    color: black;
    background-color: #ffff;
    text-shadow: none;
    white-space: normal;
    word-break: break-word;
}
${ProductName}-chat-log-bubble:first-of-type {
    border-radius: 0 var(--round) var(--round);
}
${ProductName}-chat-log-bubble-pointer {
    position: absolute;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 0 10px 10px 0;
    border-color: transparent #ffff transparent transparent;
}
${ProductName}-chat-log.outgoing {
    justify-content: flex-end;
}
${ProductName}-chat-log.outgoing .${ProductName}-avatar,
${ProductName}-chat-log.outgoing ${ProductName}-chat-log-nickname {
    visibility: collapse;
}
${ProductName}-chat-log.outgoing ${ProductName}-chat-log-bubble {
    margin-left: auto;
}
${ProductName}-chat-log.outgoing ${ProductName}-chat-log-bubble:first-of-type {
    border-radius: var(--round) 0 var(--round) var(--round);
}
${ProductName}-chat-log.outgoing ${ProductName}-chat-log-bubble-pointer {
    right: 0;
    transform: scaleX(-1);
}
${ProductName}-chat-input-box {
    display: flex;
    position: absolute;
    bottom: 0;
    right: 0;
    left: 0;
    height: var(--icon-size);
    align-items: center;
    border-radius: var(--panel-round);
    background-color: #0003;
}
${ProductName}-chat-input-box > input[type="text"] {
    flex: 1;
    height: var(--icon-size);
    margin: 0 1em;
    border: none;
    outline: none;
    color: white;
    background-color: transparent;
    text-shadow: 1px 1px 2px black;
}
${ProductName}-chat-send-button {
    --background-color-lightness: 70%;
    width: var(--icon-size);
    height: var(--icon-size);
    border-radius: var(--panel-round);
    background-color: hsl(210, 100%, var(--background-color-lightness));
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='white'%3E%3Cpath d='M0,9l4,1.5L6,16l3-4L14,14l2-14L0,9z M7,11.5l-1,2.5l-1-3l8.5-7.5L7,11.5z'/%3E%3C/svg%3E%0A");
    background-repeat: no-repeat;
    background-size: calc(var(--icon-size) / 1.8);
    background-position: 40% 55%;
    transform: scale(0.9);
}
${ProductName}-chat-send-button:hover {
    --background-color-lightness: 80%;
}
${ProductName}-chat-send-button:active {
    --background-color-lightness: 60%;
}
`);
    }

    const popcorny = SiteProfiles[location.host] ? deepMerge(Default, SiteProfiles[location.host]) : Default;
    bindAll(Default);
    bindAll(popcorny);
    const { server, session, chat, profile, video, UI, isReady, style } = unsafeWindow[ProductName] = popcorny;

    when(isReady).then(main);

    function main() {
        GM_addStyle(style);
        setInterval(session.correctAddress, 200);
        setInterval(UI.injectElement, 500);
        UI.injectElement();

        if (session.isValidURL()) {
            server.connect();
            when(server.isConnected).then(video.hookEvents);
            setInterval(() => server.pushState('keepAlive'), HeartbeatInterval);
            setInterval(server.markDisconnectedPeers, 1000);
            addEventListener('beforeunload', chat.saveChatLog);
        }
    }

    // Utility functions.
    function $(selector) {
        return document.querySelector(selector);
    }
    function createElement(type, args) {
        const element = document.createElement(type);
        for (const prop in args) {
            const arg = args[prop];
            if (prop === 'classList' && arg instanceof Array) {
                element.classList.add(...arg.filter(cls => cls));
            } else if (prop === 'children' && arg instanceof Array) {
                element.append(...arg.filter(child => child != null));
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
    function when(predicate, interval = 100) {
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (predicate()) {
                    clearInterval(timer);
                    resolve();
                }
            }, interval);
        });
    }
    const timer = {
        timers: {},
        oneshot(id, callback, interval) {
            clearTimeout(this.timers[id]);
            clearInterval(this.timers[id]);
            this.timers[id] = setTimeout(callback, interval);
        },
        periodic(id, callback, interval) {
            clearTimeout(this.timers[id]);
            clearInterval(this.timers[id]);
            this.timers[id] = setInterval(callback, interval);
        },
    };
    function saveTextToFile(filename, content) {
        const anchor = document.createElement('a');
        const file = new Blob([content], { type: 'text/plain' });
        anchor.href = URL.createObjectURL(file);
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
    }
    function getStringHashCode(str) {
        let hash = 0;
        if (!str.length) {
            return hash;
        }
        for (let i = 0; i < str.length; i++) {
            hash = (((hash << 5) - hash) + str.charCodeAt(i)) | 0;
        }
        return hash;
    }
    function from(template, initializer) {
        return Object.assign({}, template, initializer);
    }
    function bindAll(obj) {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'function') {
                obj[key] = value.bind(obj);
            } else if (value && typeof value === 'object') {
                bindAll(value);
            }
        }
    }
    function deepMerge(obj1, obj2) {
        const mergedSubobjects = {};
        for (const key in obj2) {
            if (typeof obj1[key] === 'object' && Object.getPrototypeOf(obj1[key]) === Object.prototype &&
                typeof obj2[key] === 'object' && Object.getPrototypeOf(obj2[key]) === Object.prototype) {
                mergedSubobjects[key] = deepMerge(obj1[key], obj2[key]);
            }
        }
        return Object.assign({}, obj1, obj2, mergedSubobjects);
    }
})();
