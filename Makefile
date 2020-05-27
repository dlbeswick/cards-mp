CORDOVA = node_modules/.bin/cordova
TYPESCRIPT = node_modules/.bin/tsc
SASS = sassc

OUTPUTS = $(subst .ts,.js,$(subst ts/,www/js/,$(wildcard ts/*.ts)))

.PHONY: clean serve build run run-emu cordova cordova-prepare browser 

www/js/dependencies/peerjs.min.js: node_modules/peerjs/dist/peerjs.min.js
	cp $< $@

build: www/js www/css www/css/app.css www/js/dependencies www/js/dependencies/peerjs.min.js $(OUTPUTS)

browser: build
	"$(CORDOVA)" build browser

cordova: cordova-prepare
	"$(CORDOVA)" compile

cordova-prepare: build
	"$(CORDOVA)" prepare

www/js/dependencies :
	mkdir -p $@

www/css :
	mkdir -p $@

$(OUTPUTS): www/js/%.js: ts/%.ts
	"$(TYPESCRIPT)" --noEmitOnError --strict --target es2019 --module es2015 --outDir $(@D) $<

www/css/app.css : sass/app.scss
	"$(SASS)" $< $@

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
