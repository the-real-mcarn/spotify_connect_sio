import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import shell from "child_process";
import SpotifyWebApi from "spotify-web-api-node";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// Debug mode print more messages to the terminal and changes some Electron settings
const debug = true;

console.log("Spotify Connect controller by McArn.\n");
if (debug) console.log("Debug mode enabled!");

/**
 * Express setup
 */

// Redirect index
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname + "/../public/html/index.html"));
});

// Redirect script
app.get("/js/bundle.js", (req, res) => {
    res.sendFile(path.join(__dirname + "/../build/frontend/bundle.js"));
});

// MDI fonts
app.use("/fonts", express.static(path.join(__dirname + "/../node_modules/@mdi/font/fonts")));

// Other static files
app.use("/", express.static(path.join(__dirname + "/../public/")));

/**
 * Spotify auth
 */

// Set tokens
const tokensPath = path.join(__dirname, "../keys/tokens.json");
if (!fs.existsSync(tokensPath)) {
    console.error("[AUTH] \t Keys/tokens.json does not exist!");
    process.exit();
}
// eslint-disable-next-line prefer-const
let tokens = JSON.parse(fs.readFileSync(tokensPath).toString());

// Init api instance
const spotify = new SpotifyWebApi({
    clientId: tokens.client.id,
    clientSecret: tokens.client.secret,
    redirectUri: "https://localhost/"
});

/**
 *  Save the refresh token to tokens.json for future use
 * @param token 
 */
function saveRefreshToken(token: string) {
    // Set new token for use this session
    tokens.refresh = token;
    spotify.setRefreshToken(tokens.refresh);

    // Save token to tokens.json
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 4));
}

/**
 *  Sets a timer to refresh the access token
 * @param timeout timeout in milliseconds(!)
 */
function registerRefreshTimeout(timeout: number) {
    if (debug) console.debug("[AUTH] \t Timeout registered " + String(timeout));

    setTimeout(() => {
        if (debug) console.debug("[AUTH] \t Refreshing token");

        // Refresh token
        spotify.refreshAccessToken().then(
            function (data) {
                if (debug) console.debug("[AUTH] \t Token refreshed");

                // Register a new timeout for the new token
                registerRefreshTimeout((data.body["expires_in"] * 1000));

                // Set the new access token
                spotify.setAccessToken(data.body["access_token"]);

                // The API documentation lists that the API might return a new refresh token when the access code is refreshed.
                // If this is the case, replace the old one
                if (data.body["refresh_token"]) {
                    saveRefreshToken(data.body["refresh_token"]);
                }
            },
            function (err) {
                console.error("[AUTH] \t Could not refresh the token!");
                throw err;
            }
        );
    }, timeout);
}

/**
 *  Try authorizing to the Spotify API using the Authorization Code Flow.
 *  For more info: https://developer.spotify.com/documentation/general/guides/authorization-guide/
 */
const authorization = new Promise<void>((resolve, reject) => {
    if (tokens.refresh == "" && tokens.auth == "") {
        // There is no old refresh token and no auth grant token, one will have to be made
        const scopes = ["user-read-private", "user-read-email", "user-read-playback-state", "user-read-playback-position", "user-modify-playback-state", "user-library-read", "user-library-modify"];
        const state = "ControllerAuthFlow";

        // Create and print authorization url
        console.log("Open the following URL to give this application access, once you do, paste the code part of the url in tokens.json under auth.");
        console.log(spotify.createAuthorizeURL(scopes, state));

        // Authorization failed (for now)
        reject("[AUTH] \t Cannot authenticate");
    } else if (tokens.refresh == "" && tokens.auth != "") {
        // The user inputted the auth grant token in tokens.json, use this to request access and request tokens
        if (debug) console.debug("[AUTH] \t Requesting tokens using grant");

        spotify.authorizationCodeGrant(tokens.auth).then(
            function (data) {
                // Register refresh timeout
                registerRefreshTimeout((data.body["expires_in"] * 1000));

                // Set the access token and refresh token
                spotify.setAccessToken(data.body["access_token"]);

                // Save the refresh token to disk for future use
                saveRefreshToken(data.body["refresh_token"]);

                // Authorization successful
                resolve();
            },
            function (err) {
                // Auth token probably expired or something is missing from the request
                console.log("[AUTH] \t Something went wrong when retrieving the access token!", err.message);

                // Authorization failed
                reject(err);
            }
        );
    } else if (tokens.refresh != "") {
        // Use the refresh token in tokens.json to get a new access token
        if (debug) console.debug("[AUTH] \t Using old token");

        // Use old refesh token
        spotify.setRefreshToken(tokens.refresh);

        // Refresh access token immediately
        registerRefreshTimeout(0);

        // Authorization successful
        resolve();
    }
});

authorization.then(() => {
    // Start listening when authorization is granted
    server.listen(port, () => {
        console.log(`[EXPS] \t Listening at http://localhost:${port}`);
    });

    // Launch kiosk
    let window: shell.ChildProcess;
    if (process.platform == "linux") {
        console.log("[IPC] \t Starting chromium in kiosk mode");
        window = shell.spawn("/usr/bin/chromium-browser", ["--noerrdialogs", "--disable-infobars", "--kiosk", "http://localhost:3000"]);
        // window = shell.exec("/usr/bin/chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3000");

        window.on("exit", (code) => {
            console.log(`[IPC] \t Kiosk closed with code ${code}, exiting server`);
            process.exit();
        });
    } else {
        console.error("[IPC] \t This function is not supported on your operating system, open a browser and browse to localhost manually");
    }

    // Start handling frontend requests 
    io.on("connection", (socket) => {
        if (debug) console.log("[IPC] \t Client connected");
        socket.emit("app", {
            type: "status",
            data: {
                type: "info",
                content: "Connection established"
            }
        });

        if (debug) {
            socket.emit("app", {
                type: "debug",
                data: debug
            });
        }

        socket.on("app", (data, res) => {
            if (debug) console.log("[IPC] \t App event");
            switch (data.type) {
                // Quit app
                case "quit":
                    window.kill();
                    break;

                // Shutdown device
                case "shutdown":
                    // Linux only!
                    if (process.platform == "linux") {
                        shell.exec("sudo shutdown now");
                        window.kill();
                    } else {
                        console.error("[IPC] \t This function is only supported on Linux systems");
                    }
                    break;

                // Command unknown
                default:
                    console.error("[IPC] \t Unknown command");
                    break;
            }
        });

        socket.on("spotify", async (command: string, args: string[], res) => {
            if (debug) console.log(`[IPC] \t Spotify request ${command}`);

            // TODO: Fix this
            // Passing functions through ipc is not possible so passing the function name and returning the result is the next best thing
            // However, SpotifyWebApi does not support type 'string' to be an index so I must disable typescript in order for it to compile
            // Since I have to make a scope to prevent the client from accessing the client secret this way i might as well make scope a lookup table
            // And of course eslint is going to complain about this

            const scope = [
                "getMe",
                "getMyDevices",
                "getMyCurrentPlaybackState",
                "getMyCurrentPlayingTrack",
                "pause",
                "play",
                "setRepeat",
                "skipToNext",
                "skipToPrevious",
                "setShuffle",
                "containsMySavedTracks",
                "addToMySavedTracks",
                "removeFromMySavedTracks"
            ];

            if (Object.getOwnPropertyNames(SpotifyWebApi.prototype).includes(command)) {
                if (scope.includes(command)) {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const result = await spotify[command](...args);

                    switch (result.statusCode) {
                        case 200: // Good
                            res(result.body, { code: 200, message: "OK" });
                            break;
                        case 201: // Good
                            res(result.body, { code: 201, message: "Created" });
                            break;
                        case 202: // Good
                            res(result.body, { code: 202, message: "Accepted" });
                            break;
                        case 204: // Good but results in no response
                            res(result.body, { code: 204, message: "No Content" });
                            break;
                        case 304: // Good but results in no response
                            res(result.body, { code: 304, message: "Not Modified" });
                            break;
                        case 400: // Bad
                            res({}, { code: 400, message: "Bad Request" });
                            break;
                        case 401: // Bad
                            res({}, { code: 401, message: "Unauthorized" });
                            break;
                        case 403: // Bad
                            res({}, { code: 403, message: "Forbidden" });
                            break;
                        case 404: // Bad
                            res({}, { code: 404, message: "Not Found" });
                            break;
                        case 429: // Bad
                            res({}, { code: 429, message: "Too Many Requests" });
                            break;
                        case 500: // Bad
                            res({}, { code: 500, message: "Internal Server Error" });
                            break;
                        case 502: // Bad
                            res({}, { code: 502, message: "Bad Gateway" });
                            break;
                        case 503: // Bad
                            res({}, { code: 503, message: "Service unavailable" });
                            break;
                    }
                } else {
                    console.error("[IPC] \t Command is out of scope");
                    res({}, { code: 403, message: "Command is out of scope" });
                }
            } else {
                console.error("[IPC] \t Command does not exist");
                res({}, { code: 404, message: "Command does not exist" });
            }
        });
    });

}).catch((err) => {
    // Cannot continue, print errors along the way and quit
    console.error(err);
    process.exit();
});
