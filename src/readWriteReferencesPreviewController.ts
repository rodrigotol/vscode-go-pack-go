import * as vscode from "vscode";
import { ClassifiedReference } from './readWriteReferencesTypes';

export class PreviewController {
    private readonly decoration: vscode.TextEditorDecorationType
    private previewUri: vscode.Uri | undefined;
    private originColumn: vscode.ViewColumn | undefined;

    constructor() {
        this.decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(
                "editor.findMatchHighlightBackground"
            ),
            borderRadius: "2px",
            overviewRulerColor: new vscode.ThemeColor(
                "editorOverviewRuler.findMatchForeground"
            )
        });
    }

    setOriginColumn(column: vscode.ViewColumn | undefined): void {
        this.originColumn = column ?? vscode.ViewColumn.One;
    }

    async preview(ref: ClassifiedReference): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(ref.uri);
        const editor = await vscode.window.showTextDocument(doc, { 
            viewColumn: vscode.ViewColumn.Beside,
            preview: true, 
            preserveFocus: true, 
            selection: ref.range 
        });
        this.reveal(editor, ref.range)
        this.previewUri = ref.uri;
    }

    async openPermanent(ref: ClassifiedReference): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(ref.uri);
        const editor = await vscode.window.showTextDocument(doc, { 
            viewColumn: this.originColumn,
            preview: false, 
            preserveFocus: false, 
            selection: ref.range 
        });
        this.reveal(editor, ref.range)
        this.closePreviewTab();
    }

    async closePreviewTab(): Promise<void> {
        const uri = this.previewUri;
        if (!uri) {
            return;
        }

        this.previewUri = undefined;
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (
                    tab.isPreview &&
                    tab.input instanceof vscode.TabInputText &&
                    tab.input.uri.toString() === uri.toString()
                ) {
                    await vscode.window.tabGroups.close(tab);
                    return;
                }
            }
        }
    }

    private reveal(editor: vscode.TextEditor, range: vscode.Range): void {
        editor.revealRange(
            range,
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
        editor.setDecorations(this.decoration, [range]);
    }

    dispose(): void {
        this.decoration.dispose();
    }
}