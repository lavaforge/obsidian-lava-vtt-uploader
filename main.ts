import {
    App,
    Setting,
    FileSystemAdapter,
    Menu,
    Plugin,
    PluginSettingTab,
    TFile,
    Notice,
} from 'obsidian';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';

interface LavaVttPluginSettings {
    serverAddress: string;
}

const DEFAULT_SETTINGS: LavaVttPluginSettings = {
    serverAddress: 'http://localhost:3000',
};

export default class LavaVttPlugin extends Plugin {
    private settings: LavaVttPluginSettings;

    private get apiBaseUrl() {
        return `${this.settings.serverAddress}/api/`;
    }

    public get serverAddress() {
        return this.settings.serverAddress;
    }

    async onload() {
        await this.loadSettings();

        this.registerDomEvent(document, 'contextmenu', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.localName !== 'img') return;

            const imgPath = (target as HTMLImageElement).currentSrc;
            // @ts-expect-error resolveFileUrl is not part of the public API
            const file = this.app.vault.resolveFileUrl(imgPath);

            if (!(file instanceof TFile)) return;
            if (!(this.app.vault.adapter instanceof FileSystemAdapter)) return;

            const adapter = this.app.vault.adapter;

            const menu = new Menu();
            menu.addItem((item) => {
                item.setTitle(`Display in Lava VTT`).onClick(async () => {
                    await this.postImage(adapter, file);
                });
            });

            menu.showAtPosition({ x: event.pageX, y: event.pageY });
        });

        this.addSettingTab(new LavaVttSettingTab(this.app, this));
    }

    private async postImage(adapter: FileSystemAdapter, file: TFile) {
        const fileContent = await fs.readFile(adapter.getFullPath(file.path));

        const hash = hashBuffer(fileContent);

        let imageExistsCheck: Response;
        try {
            imageExistsCheck = await fetch(`${this.apiBaseUrl}image/${hash}`, {
                method: 'HEAD',
            });
        } catch (e) {
            new Notice('The configured Lava VTT server is not reachable.');
            throw e;
        }

        if (imageExistsCheck.status !== 200) {
            await fetch(`${this.apiBaseUrl}image`, {
                method: 'POST',
                body: fileContent,
                headers: { 'Content-Type': 'application/octet-stream' },
            }).catch((e) => {
                new Notice('Failed to upload image to Lava VTT.');
                throw e;
            });
        }

        await fetch(`${this.apiBaseUrl}display`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ hash }),
        }).catch((e) => {
            new Notice('Failed to display image in Lava VTT.');
            throw e;
        });
    }

    onunload() {}

    async loadSettings() {
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(await this.loadData()),
        };
    }

    async saveSettings(data: LavaVttPluginSettings) {
        this.settings = data;
        await this.saveData(this.settings);
    }
}

class LavaVttSettingTab extends PluginSettingTab {
    plugin: LavaVttPlugin;

    constructor(app: App, plugin: LavaVttPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Server address')
            .setDesc('The address of the lava-vtt server')
            .addText((text) =>
                text
                    .setPlaceholder('e.g. http://localhost:3000')
                    .setValue(this.plugin.serverAddress)
                    .onChange(async (value) => {
                        await this.plugin.saveSettings({
                            serverAddress: value,
                        });
                    }),
            );
    }
}

function hashBuffer(buffer: Buffer): string {
    return createHash('sha1').update(buffer).digest('hex');
}
