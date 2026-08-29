install:
	npm run compile && vsce package && code --install-extension go-pack-go-0.0.1.vsix