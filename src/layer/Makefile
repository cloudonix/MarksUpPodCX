LAYER_NAME := marksuppodcx-layer
AWS_REGION ?= us-east-1
AWS_PROFILE ?= default

all: publish

clean:
	rm $(LAYER_NAME).zip
	rm -rf nodejs/node_modules

nodejs/node_modules:
	(cd nodejs; npm install)

$(LAYER_NAME).zip: nodejs nodejs/node_modules
	zip -r9 $(LAYER_NAME).zip nodejs

.published: $(LAYER_NAME).zip
	aws --region $(AWS_REGION) --profile $(AWS_PROFILE) lambda publish-layer-version --layer-name $(LAYER_NAME) --description "$(LAYER_NAME) libraries" --zip-file fileb://$(LAYER_NAME).zip --compatible-runtimes nodejs14.x nodejs16.x
	touch .published

publish: .published

.PHONY: all publish clean
