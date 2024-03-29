"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Manager = void 0;
/* eslint-disable no-async-promise-executor */
const collection_1 = __importDefault(require("@discordjs/collection"));
const axios_1 = __importDefault(require("axios"));
const events_1 = require("events");
const Utils_1 = require("./Utils");
const TEMPLATE = JSON.stringify(["event", "guildId", "op", "sessionId"]);
function check(options) {
    if (!options)
        throw new TypeError("ManagerOptions must not be empty.");
    if (typeof options.send !== "function")
        throw new TypeError('Manager option "send" must be present and a function.');
    if (typeof options.nodes !== "undefined" &&
        !Array.isArray(options.nodes))
        throw new TypeError('Manager option "nodes" must be a array.');
    if (typeof options.shards !== "undefined" &&
        typeof options.shards !== "number")
        throw new TypeError('Manager option "shards" must be a number.');
    if (typeof options.plugins !== "undefined" &&
        !Array.isArray(options.plugins))
        throw new TypeError('Manager option "plugins" must be a Plugin array.');
    if (typeof options.autoPlay !== "undefined" &&
        typeof options.autoPlay !== "boolean")
        throw new TypeError('Manager option "autoPlay" must be a boolean.');
    if (typeof options.trackPartial !== "undefined" &&
        !Array.isArray(options.trackPartial))
        throw new TypeError('Manager option "trackPartial" must be a string array.');
}
/** @noInheritDoc */
class Manager extends events_1.EventEmitter {
    /**
     * Initiates the Manager class.
     * @param options
     */
    constructor(options) {
        super();
        /** The map of players. */
        this.players = new collection_1.default();
        /** The map of nodes. */
        this.nodes = new collection_1.default();
        this.initiated = false;
        check(options);
        if (options.trackPartial) {
            Utils_1.TrackUtils.setTrackPartial(options.trackPartial);
            delete options.trackPartial;
        }
        this.options = Object.assign({ plugins: [], nodes: [{ identifier: "default", host: "localhost" }], shards: 1, autoPlay: true }, options);
        if (this.options.plugins) {
            for (const [index, plugin] of this.options.plugins.entries()) {
                if (!(plugin instanceof Utils_1.Plugin))
                    throw new RangeError(`Plugin at index ${index} does not extend Plugin.`);
                plugin.load(this);
            }
        }
        if (this.options.nodes) {
            for (const nodeOptions of this.options.nodes) {
                const node = new (Utils_1.Structure.get("Node"))(this, nodeOptions);
                this.nodes.set(node.options.identifier, node);
            }
        }
    }
    /** Returns the least used Nodes. */
    get leastUsedNodes() {
        return this.nodes
            .filter((node) => node.connected)
            .sort((a, b) => b.calls - a.calls);
    }
    /** Returns the least system load Nodes. */
    get leastLoadNodes() {
        return this.nodes
            .filter((node) => node.connected)
            .sort((a, b) => {
                const aload = a.stats.cpu
                    ? (a.stats.cpu.systemLoad / a.stats.cpu.cores) * 100
                    : 0;
                const bload = b.stats.cpu
                    ? (b.stats.cpu.systemLoad / b.stats.cpu.cores) * 100
                    : 0;
                return aload - bload;
            });
    }
    /**
     * Initiates the Manager.
     * @param client
     */
    init(client) {
        if (this.initiated)
            return this;
        if (!this.options.client && !client)
            throw new Error('"clientId" is not set. Pass it in Manager#init() or as a option in the constructor.');
        this.options.client = client;
        for (const node of this.nodes.values()) node.connect();

        Utils_1.Structure.get("Player").init(this);
        this.initiated = true;
        return this;
    }
    /**
     * Searches the enabled sources based off the URL or the `source` property.
     * @param query
     * @param requester
     * @returns The search result.
     */
    search(query, requester) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const node = this.leastUsedNodes.first();
            if (!node)
                throw new Error("No available nodes.");
            const sources = {
                soundcloud: "sc",
                youtube: "yt",
            };
            const source = sources[(_a = query.source) !== null && _a !== void 0 ? _a : "youtube"];
            let search = query.query || query;
            if (!/^https?:\/\//.test(search)) {
                search = `${source}search:${search}`;
            }
            const uri = `http${node.options.secure ? "s" : ""}://${node.options.host}:${node.options.port}/loadtracks`;
            const res = yield axios_1.default.get(uri, {
                headers: { Authorization: node.options.password },
                params: { identifier: search },
                timeout: 10000,
                timeoutErrorMessage: `Node ${node.options.identifier} search timed out.`,
            }).catch((err) => {
                return reject(err);
            });
            node.calls++;
            if (!res || !res.data) {
                return reject(new Error("Query not found."));
            }
            const result = {
                loadType: res.data.loadType,
                exception: (_b = res.data.exception) !== null && _b !== void 0 ? _b : null,
                tracks: res.data.tracks.map((track) => Utils_1.TrackUtils.build(track, requester)),
            };
            if (result.loadType === "PLAYLIST_LOADED") {
                result.playlist = {
                    name: res.data.playlistInfo.name,
                    selectedTrack: res.data.playlistInfo.selectedTrack === -1 ? null :
                        Utils_1.TrackUtils.build(res.data.tracks[res.data.playlistInfo.selectedTrack], requester),
                    duration: result.tracks
                        .reduce((acc, cur) => acc + (cur.duration || 0), 0),
                };
            }
            return resolve(result);
        }));
    }
    /**
     * Decodes the base64 encoded tracks and returns a TrackData array.
     * @param tracks
     */
    decodeTracks(tracks) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            const node = this.nodes.first();
            if (!node)
                throw new Error("No available nodes.");
            const uri = `http${node.options.secure ? "s" : ""}://${node.options.host}:${node.options.port}/decodetracks`;
            const res = yield axios_1.default.post(uri, tracks, {
                headers: { Authorization: node.options.password },
            }).catch((err) => {
                return reject(err);
            });
            node.calls++;
            if (!res || !res.data) {
                return reject(new Error("No data returned from query."));
            }
            return resolve(res.data);
        }));
    }
    /**
     * Decodes the base64 encoded track and returns a TrackData.
     * @param track
     */
    decodeTrack(track) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                const res = yield this.decodeTracks([track]);
                return resolve(res[0]);
            }
            catch (e) {
                return reject(e);
            }
        }));
    }
    /**
     * Creates a player or returns one if it already exists.
     * @param options
     */
    create(options) {
        if (this.players.has(options.guild.id)) {
            return this.players.get(options.guild.id);
        }
        return new (Utils_1.Structure.get("Player"))(options);
    }
    /**
     * Returns a player or undefined if it does not exist.
     * @param guildID
     */
    get(guildID) {
        return this.players.get(guildID);
    }
    /**
     * Destroys a player if it exists.
     * @param guildID
     */
    destroy(guildID) {
        this.players.delete(guildID);
    }
    /**
     * Sends voice data to the Lavalink server.
     * @param data
     */
    updateVoiceState(data) {
        if (!data ||
            !["VOICE_SERVER_UPDATE", "VOICE_STATE_UPDATE"].includes(data.t || ""))
            return;
        const player = this.players.get(data.d.guild_id);
        if (!player)
            return;
        const state = player.voiceState;
        if (data.t === "VOICE_SERVER_UPDATE") {
            state.op = "voiceUpdate";
            state.guildId = data.d.guild_id;
            state.event = data.d;
        }
        else {
            if (data.d.user_id !== this.options.client.user.id)
                return;
            state.sessionId = data.d.session_id;
            if (player.voiceChannel.id !== data.d.channel_id) {
                if (!data.d.channel_id) this.emit("playerDisconnect", player, player.voiceChannel);
                else {
                    const newChannelOBJ = player.guild.channels.resolve(data.d.channel_id);
                    this.emit("playerMove", player, player.voiceChannel, newChannelOBJ);
                    player.voiceChannel = newChannelOBJ;
                }
            }
        }
        player.voiceState = state;
        if (JSON.stringify(Object.keys(state).sort()) === TEMPLATE)
            player.node.send(state);
    }
}
exports.Manager = Manager;
