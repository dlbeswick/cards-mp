# Overview

A browser-based multiplayer card game, making use of WebRTC (via PeerJS) and Web Audio API.

Can be played with local players (one per-device) or remotely.

Many rough edges yet to be smoothed out.

2-8 players are supported, depending on the game.

There's support for Gin Rummy, 500/Dummy, Chinese Poker, some regular variants of Poker, and Hearts.

# To play and connect

1. Give yourself a unique player name in the "My id" field.
1. Click the "Register" button to register your player with a PeerJS server. Either run your own local PeerJS server (recommended) or leave the "Server" field blank to use the default servers provided by the PeerJS project.
1. In the "Connect to" field, specify another player who's also registered.
1. Press the Connect button.

When you connect, you will also be automatically connected to any peers that the target is connected to.

Tap a card to select, then tap the destination area on the playfield to move the card there. Tapping a card as destination will move the source card behind that card. Tapping the playfield will move that card to the head of the slot.

Long-pressing a card will flip it over. This can be used to "knock" in Gin Rummy. When playing 500/Dummy, long-pressing a card in the meld-forming area will turn it 90 degrees, which can be used to show that the card belongs to another player.

Tapping a "chips" slot instead of the chip itself will select all chips in that slot.

"New Game" will start a brand new game, whereas "New Hand" starts a new deal. There's only a difference between these two options for some games, such as Poker, where "New Hand" will reset cards but not chips accumulated.

Use the "Save" and "Load" buttons if you need to pause the game and come back to it later. If you save a game, then it's automatically reloaded when you visit next time.

If anything goes really wacky, use the "Sync" button to synchronise the playfield across all devices.

If the worst should happen due to bugs and cards stop responding to input or your moves aren't showing up in other's games, then reload and reconnect.

# Building and running

1. Install NPM.
1. Install Make (i.e. via `apt install build-essential`).
1. Then run:

	$ npm install
	$ make serve

Connect using your browser (on PC, phone, tablet, etc.) to the address that appears when you run `make serve`.

# A note on PeerJS server

This handy project is there to satisfy WebRTC requirements and act as a STUN server to negotiate client firewalls. Once the negotiation is done, all communication is peer-to-peer. Unfortunately this is also required when all clients are on the same local network, because of the way that WebRTC operates.

# Running your own PeerJS server

It's very easy, and recommended. If you host a PeerJS server on port 9000 on the same host as the game is hosted, then it will be discovered automatically by the game.

1. Install NPM.
1. `$ npm install peer -g`
1. `$ peerjs --port 9000`

Perhaps you'd like to create a new user-local SystemD unit:

`$ systemctl edit --user --force --full peerjs.service`

```
[Unit]
Description=PeerJS
WantedBy=network-online.target

[Service]
ExecStart=/usr/local/bin/peerjs --port 9000
```

# Known issues and work to be done

* There is no "authority", by design, and there are some rough-and-ready rules such as "whoever is connecting as source accepts the destination's playfield as authorative." These could be improved. However, as long as everyone is using the same rules then the playfield shouldn't need to be synced unless there's a bug in the code. There are bugs in the code.
* There is no protection from anyone trying to gatecrash your game. Use a hard-to-guess player name prefix if concerned, or a local PeerJS server.
* You need to re-register if you switch away from the browser on your device, as the connection will drop. This re-connection should be automated.
* Detecting and correcting conflicting moves in the playfield could be much improved.
* In Safari, the "Web Animations API" often needs to be activated in Advanced Settings to get the cards animating when they move.
* Card re-sizing has minor layout issues.
* The absolute minimum of logic is implemented for each game. The rationale is that players will often have different "house rules" and their own preferences and scoring systems. A better balance can likely be found than the current situation, though, that removes more of the repetitive tasks that each game has.
* Could be packaged as an "app", but just tested in the browser for now.
* Instructions for each game should be included.
* Should have an easy way to keep scores.
* Better error recovering in general is needed.

# Credits

Thanks to the authors for these resources:

`https://commons.wikimedia.org/wiki/File:English_pattern_playing_cards_deck.svg` by Dmitry Fomin
`https://commons.wikimedia.org/wiki/File:Contemporary_playing_cards.svg` by Betzaar
`https://commons.wikimedia.org/wiki/File:Card_back_12.svg` by David Bellot

Thanks also to the authors of the open-source supporting libraries used by this project.
