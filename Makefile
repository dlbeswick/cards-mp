CORDOVA = node_modules/.bin/cordova
TYPESCRIPT = node_modules/.bin/tsc
SASS = sass

SRC = ts/app.ts ts/assert.ts ts/dom.ts ts/game.ts ts/ui.ts

.PHONY: clean serve build run run-emu cordova cordova-prepare browser 

www/js/peerjs.min.js: node_modules/peerjs/dist/peerjs.min.js
	cp $< $@

build: www/js www/css www/css/app.css www/js/*.js www/js/peerjs.min.js 

browser: build
	"$(CORDOVA)" build browser

cordova: cordova-prepare
	"$(CORDOVA)" compile

cordova-prepare: build
	"$(CORDOVA)" prepare

www/js :
	mkdir -p $@

www/css :
	mkdir -p $@

www/js/app.js: ts/*.ts
	"$(TYPESCRIPT)" --noEmitOnError --strict --target es2019 --module es2015 --outDir www/js ts/app.ts

www/css/app.css : sass/app.scss
	"$(SASS)" $<:$@

run: build
	"$(CORDOVA)" run android --device

run-emu: build
	"$(CORDOVA)" run android --emulator

serve: cordova-prepare build browser
	"$(CORDOVA)" run browser

clean:
	rm -rf www/css
	rm -rf www/js
	"$(CORDOVA)" clean
