import moment from "moment";
import { io } from "socket.io-client";
const socket = io();
let debug = false;

const responseCodes = [200, 201, 202, 204, 304];


/**
 *  Clock
 */

setInterval(() => {
    document.querySelector("span#time").innerHTML = moment().format("HH:mm");
}, 1000);


/**
 *  Footer button handlers
 */

// Refesh button
document.querySelector("span#reload")?.addEventListener("click", () => {
    window.location.reload();
});

// Quit button
document.querySelector("span#quit")?.addEventListener("click", () => {
    if (debug) console.log("[IPC] \t Request quit");
    socket.emit("app", {
        type: "quit"
    });
});

// Shutdown button
document.querySelector("span#shutdown")?.addEventListener("click", () => {
    if (debug) console.log("[IPC] \t Request shutdown");
    socket.emit("app", {
        type: "shutdown"
    });
});


/**
 *  Music control button handlers
 */




/**
 *  Handle backend messages
 */

let messageTimeout: NodeJS.Timeout;

function message(type: string, content: string) {
    const status = document.querySelector("span#status") as HTMLSpanElement;
    const icon = document.createElement("i");
    const contentElement = document.createElement("span");
    contentElement.innerHTML = content;

    switch (type) {
        case "info": {
            icon.className = "mdi mdi-comment";
            icon.style.color = "#c8c8c8";
            break;
        }
        case "warning": {
            icon.className = "mdi mdi-comment-alert";
            icon.style.color = "#F4B266";
            break;
        }
        case "error": {
            icon.className = "mdi mdi-comment-remove";
            icon.style.color = "#C33C54";
            break;
        }
    }
    status.replaceChildren(icon, contentElement);

    if (type != "error") {
        messageTimeout = setTimeout(() => {
            contentElement.innerHTML = "";
            icon.className = "mdi mdi-comment-check";
            icon.style.color = "#c8c8c8";
            status.replaceChildren(icon, contentElement);
        }, 8000);
    } else {
        clearTimeout(messageTimeout);
    }
}

// App related (status errors)
socket.on("app", (response: { type: string, data: any }) => {
    if (debug) console.log("[IPC] \t App event");
    switch (response.type) {
        case "debug":
            debug = response.data;
            if (debug) message("warning", "Debug mode enabled!");
            break;
        case "status":
            message(response.data.type, response.data.content);
            break;
        default:
            console.error("[IPC] \t Unknown command");
            break;
    }
});

/**
 *  Update playback display
 */

let barUpdateInterval: NodeJS.Timer;
let endOfItemTimeout: NodeJS.Timeout;
let itemProgressMs: number;

function updatePlaybackState() {
    socket.emit("spotify", "getMyCurrentPlaybackState", [], (data: SpotifyApi.CurrentPlaybackResponse, response: { code: number, message: string }) => {
        if (responseCodes.indexOf(response.code) != -1) {
            console.log(data);
            if (response.code == 200) {
                // Device info
                document.querySelector("div#device > span#name").innerHTML = data.device.name;

                updatePlaybackTime(data.progress_ms, data.item.duration_ms);

                let item: SpotifyApi.TrackObjectFull | SpotifyApi.EpisodeObject;

                if (data.currently_playing_type == "track") {
                    item = data.item as SpotifyApi.TrackObjectFull;

                    // Track info
                    (document.querySelector("div#playing > img") as HTMLImageElement).src = item.album.images[0].url;
                    document.querySelector("div#header > span#album").innerHTML = item.album.name;

                    document.querySelector("div#info > div > span#name").innerHTML = item.name;

                    let text = "";

                    for (let index = 0; index < item.artists.length; index++) {
                        const element = item.artists[index].name;
                        text += element;

                        if (index != item.artists.length - 1) {
                            text += ", ";
                        }
                    }

                    document.querySelector("div#info > div > span#artist").innerHTML = text;
                } else if (data.currently_playing_type == "episode") {
                    item = data.item as SpotifyApi.EpisodeObject;

                    // Episode info
                    (document.querySelector("div#playing > img") as HTMLImageElement).src = item.images[0].url;
                    document.querySelector("div#header > span#album").innerHTML = item.show.name;

                    document.querySelector("div#info > div > span#name").innerHTML = item.name;
                    document.querySelector("div#info > div > span#artist").innerHTML = item.release_date;
                }
            } else if (response.code == 204) {
                // No player active
                message("warning", "No active sessions");
                document.querySelector("div#device > span#name").innerHTML = "None";
            }
        } else {
            message("error", response.message);
        }
    });
}

function msToStamp(number: number) {
    let value = "";

    value += String(Math.floor((number / 1000) / 60));
    value += ":"; 

    const seconds = Math.floor((number / 1000) % 60);
    if (seconds < 10) {
        value += "0"; 
    }
    value += String(seconds);

    return value;
}

function updatePlaybackTime(start: number, end: number) {
    const timeCurrent = document.querySelector("div#progress > span#start") as HTMLSpanElement;
    const timeEnd = document.querySelector("div#progress > span#end") as HTMLSpanElement;

    itemProgressMs = start;
    timeCurrent.innerHTML = msToStamp(start);
    
    timeEnd.innerHTML = msToStamp(end);

    const barFull = document.querySelector("div#progress > div#bar") as HTMLDivElement;
    let maxWidth = barFull.offsetWidth;
    const barValue = document.querySelector("div#progress > div#bar > div#value") as HTMLDivElement;
    maxWidth = maxWidth - (parseFloat(getComputedStyle(barValue).padding) * 2);
    console.log(maxWidth);

    // Register interval to update the timer and bar
    if (barUpdateInterval) {
        clearInterval(barUpdateInterval);
    }

    barUpdateInterval = setInterval(() => {
        itemProgressMs += 1000;
        timeCurrent.innerHTML = msToStamp(itemProgressMs);
    }, 1000);

    // Register full update timeout for when the song ends
}


/**
 *  Startup calls
 */

document.addEventListener("DOMContentLoaded", () => {
    // Grab required initial data
    socket.emit("spotify", "getMe", [], (data: SpotifyApi.CurrentUsersProfileResponse, response: { code: number, message: string }) => {
        if (responseCodes.indexOf(response.code) != -1) {
            (document.querySelector("div#user > img") as HTMLImageElement).src = data.images[0].url;
            document.querySelector("span#name").innerHTML = data.display_name;
        } else {
            message("error", response.message);
        }
    });

    updatePlaybackState();
});

// Alert user when there is a connection error
socket.on("connect_error", () => {
    message("error", "Socket disconnected!");
});

// Reload if the server has restarted
socket.io.on("reconnect", () => {
    if (debug) console.log("[IPC] \t Reload required");
    window.location.reload();
});