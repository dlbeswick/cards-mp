CORDOVA = node_modules/.bin/cordova
TYPESCRIPT = node_modules/.bin/tsc
SASS = sass

SRC = ts/cards.ts

.PHONY: clean serve build run run-emu cordova cordova-prepare browser 

www/js/peerjs.min.js: node_modules/peerjs/dist/peerjs.min.js
	cp $< $@

build: www/css/app.css www/js/app.js www/js/peerjs.min.js | www/js www/css

browser: cordova-prepare
	"$(CORDOVA)" build browser

cordova: cordova-prepare
	"$(CORDOVA)" compile

cordova-prepare: build
	"$(CORDOVA)" prepare

www/js :
	mkdir -p $@

www/css :
	mkdir -p $@

www/js/app.js : $(SRC)
	"$(TYPESCRIPT)" --noEmitOnError --alwaysStrict --strictNullChecks --target es2019 --outFile $@ $<

www/css/app.css : sass/app.scss
	"$(SASS)" $<:$@

run: build cordova-prepare
	"$(CORDOVA)" run android --device

run-emu: build cordova-prepare
	"$(CORDOVA)" run android --emulator

serve: build browser
	"$(CORDOVA)" run browser

clean:
	rm -rf www/css
	rm -rf www/js
	"$(CORDOVA)" clean
