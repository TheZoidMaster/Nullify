const clientId = "3c334ae39e734129a8a0533019ac7225"; // Replace with your client ID
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

function getStoredAccessToken() {
    const stored = localStorage.getItem("accessToken");
    if (!stored || stored === "undefined") return null;
    try {
        const { token, expiry } = JSON.parse(stored);
        if (Date.now() < expiry) return token;
    } catch (e) {
        localStorage.removeItem("accessToken");
    }
    return null;
}

(async function init() {
    const clientId = "3c334ae39e734129a8a0533019ac7225"; // Replace with your client ID
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    let accessToken = getStoredAccessToken();

    if (!accessToken) {
        if (!code) {
            redirectToAuthCodeFlow(clientId);
            return;
        } else {
            accessToken = await getAccessToken(clientId, code);
            // Clear the code parameter from URL
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );
        }
    }

    updateCurrentlyPlaying(accessToken);
    setInterval(() => updateCurrentlyPlaying(accessToken), 5000); // Update every 5 seconds
    setupBlacklistButtons(accessToken);
    displayBlacklist();
})();

export async function redirectToAuthCodeFlow(clientId) {
    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", "http://localhost:5173/callback");
    params.append(
        "scope",
        "user-modify-playback-state user-read-playback-state"
    );
    params.append("code_challenge_method", "S256");
    params.append("code_challenge", challenge);

    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length) {
    let text = "";
    let possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export async function getAccessToken(clientId, code) {
    const verifier = localStorage.getItem("verifier");

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "http://localhost:5173/callback");
    params.append("code_verifier", verifier);

    const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
    });

    const data = await result.json();
    const access_token = data.access_token;
    const expiresIn = data.expires_in; // in seconds

    // Store the token with its expiry time
    localStorage.setItem(
        "accessToken",
        JSON.stringify({
            token: access_token,
            expiry: Date.now() + expiresIn * 1000,
        })
    );
    return access_token;
}

async function fetchCurrentlyPlaying(token) {
    const result = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        }
    );

    if (result.status === 204 || result.status === 200) {
        return await result.json();
    } else {
        return null;
    }
}

async function fetchBlacklist() {
    const blacklist = localStorage.getItem("blacklist");
    return blacklist ? JSON.parse(blacklist) : { songs: [], artists: [] };
}

async function updateCurrentlyPlaying(token) {
    const currentlyPlaying = await fetchCurrentlyPlaying(token);
    const blacklist = await fetchBlacklist();

    if (currentlyPlaying && currentlyPlaying.item) {
        const songId = currentlyPlaying.item.id;
        const artistIds = currentlyPlaying.item.artists.map(
            (artist) => artist.id
        );

        if (
            blacklist.songs.some((item) => item.id === songId) ||
            artistIds.some((id) =>
                blacklist.artists.some((item) => item.id === id)
            )
        ) {
            await skipToNextSong(token);
            // don't bother checking again, we'll check the next song on the next update to avoid rate limiting
            populateCurrentlyPlaying(currentlyPlaying);
        } else {
            populateCurrentlyPlaying(currentlyPlaying);
        }
    } else {
        populateCurrentlyPlaying(null);
    }
}

// Update addToBlacklist to store an object with id and name.
function addToBlacklist(type, id, name) {
    const blacklist = JSON.parse(localStorage.getItem("blacklist")) || {
        songs: [],
        artists: [],
    };
    if (!blacklist[type].some((item) => item.id === id)) {
        blacklist[type].push({ id, name });
        localStorage.setItem("blacklist", JSON.stringify(blacklist));
    }
}

// Update removeFromBlacklist to remove by object id.
function removeFromBlacklist(type, id) {
    const blacklist = JSON.parse(localStorage.getItem("blacklist")) || {
        songs: [],
        artists: [],
    };
    blacklist[type] = blacklist[type].filter((item) => item.id !== id);
    localStorage.setItem("blacklist", JSON.stringify(blacklist));
}

function setupBlacklistButtons(token) {
    const btnBlacklistSong = document.getElementById("blacklist-song");
    if (btnBlacklistSong) {
        btnBlacklistSong.addEventListener("click", async () => {
            const currentlyPlaying = await fetchCurrentlyPlaying(token);
            if (currentlyPlaying && currentlyPlaying.item) {
                const songId = currentlyPlaying.item.id;
                const songName = currentlyPlaying.item.name;
                addToBlacklist("songs", songId, songName);
                displayBlacklist();
            }
        });
    }

    const btnBlacklistArtists = document.getElementById("blacklist-artists");
    if (btnBlacklistArtists) {
        btnBlacklistArtists.addEventListener("click", async (event) => {
            if (event.target.tagName === "BUTTON") {
                const artistId = event.target.dataset.artistId;
                const artistName = event.target.dataset.artistName;
                addToBlacklist("artists", artistId, artistName);
                displayBlacklist();
            }
        });
    }

    const btnRemoveBlacklistSong = document.getElementById(
        "remove-blacklist-song"
    );
    if (btnRemoveBlacklistSong) {
        btnRemoveBlacklistSong.addEventListener("click", async () => {
            const currentlyPlaying = await fetchCurrentlyPlaying(token);
            if (currentlyPlaying && currentlyPlaying.item) {
                const songId = currentlyPlaying.item.id;
                removeFromBlacklist("songs", songId);
                displayBlacklist();
            }
        });
    }

    const btnRemoveBlacklistArtist = document.getElementById(
        "remove-blacklist-artist"
    );
    if (btnRemoveBlacklistArtist) {
        btnRemoveBlacklistArtist.addEventListener("click", async () => {
            const currentlyPlaying = await fetchCurrentlyPlaying(token);
            if (currentlyPlaying && currentlyPlaying.item) {
                const artistIds = currentlyPlaying.item.artists.map(
                    (artist) => artist.id
                );
                artistIds.forEach((id) => removeFromBlacklist("artists", id));
                displayBlacklist();
            }
        });
    }
}

async function skipToNextSong(token) {
    await fetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
}

function populateCurrentlyPlaying(currentlyPlaying) {
    if (currentlyPlaying && currentlyPlaying.item) {
        document.getElementById("song-name").innerText =
            currentlyPlaying.item.name;
        document.getElementById("artist-name").innerText =
            currentlyPlaying.item.artists
                .map((artist) => artist.name)
                .join(", ");
        document.getElementById("album-name").innerText =
            currentlyPlaying.item.album.name;
        document.getElementById("album-art").src =
            currentlyPlaying.item.album.images[0].url;

        const blacklistArtistsDiv =
            document.getElementById("blacklist-artists");
        blacklistArtistsDiv.innerHTML = "";
        currentlyPlaying.item.artists.forEach((artist) => {
            const button = document.createElement("button");
            button.innerText = `Blacklist ${artist.name}`;
            button.dataset.artistId = artist.id;
            button.dataset.artistName = artist.name; // Add artist name for later use.
            blacklistArtistsDiv.appendChild(button);
        });
    } else {
        document.getElementById("song-name").innerText =
            "No song currently playing";
        document.getElementById("artist-name").innerText = "";
        document.getElementById("album-name").innerText = "";
        document.getElementById("album-art").src = "";
    }
}

function displayBlacklist() {
    const blacklist = JSON.parse(localStorage.getItem("blacklist")) || {
        songs: [],
        artists: [],
    };
    const blacklistItems = document.getElementById("blacklist-items");
    blacklistItems.innerHTML = "";

    blacklist.songs.forEach((item) => {
        // item = { id, name }
        const li = document.createElement("li");
        li.innerText = `Song: ${item.name} (ID: ${item.id})`;
        const button = document.createElement("button");
        button.innerText = "Remove";
        button.addEventListener("click", () => {
            removeFromBlacklist("songs", item.id);
            displayBlacklist();
        });
        li.appendChild(button);
        blacklistItems.appendChild(li);
    });

    blacklist.artists.forEach((item) => {
        // item = { id, name }
        const li = document.createElement("li");
        li.innerText = `Artist: ${item.name} (ID: ${item.id})`;
        const button = document.createElement("button");
        button.innerText = "Remove";
        button.addEventListener("click", () => {
            removeFromBlacklist("artists", item.id);
            displayBlacklist();
        });
        li.appendChild(button);
        blacklistItems.appendChild(li);
    });
}
