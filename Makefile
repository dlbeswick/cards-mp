CORDOVA = node_modules/.bin/cordova
TYPESCRIPT = node_modules/.bin/tsc
SASS = sassc

.PHONY: clean serve build run run-emu cordova cordova-prepare browser publish

browser: build
	"$(CORDOVA)" build browser

build: www/css www/js/dependencies www/js/dependencies/peerjs.min.js $(OUTPUTS) www/css/app.css
	"$(TYPESCRIPT)"

www/js/dependencies/peerjs.min.js: node_modules/peerjs/dist/peerjs.min.js
	cp $< $@

cordova: cordova-prepare
	"$(CORDOVA)" compile

cordova-prepare: build
	"$(CORDOVA)" prepare

www/js/dependencies :
	mkdir -p $@

www/css :
	mkdir -p $@

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

publish: build
	test -d "$(PUBLISH_DIR)" || { echo "Non-existent PUBLISH_DIR"; exit 1; }
	rm -r "$(PUBLISH_DIR)/cards" || true
	cp -r platforms/browser/www "$(PUBLISH_DIR)/cards"
	find "$(PUBLISH_DIR)/cards" -name '*.tsbuildinfo' -delete
