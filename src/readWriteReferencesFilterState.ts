import * as vscode from 'vscode';
import {RefKind} from './readWriteReferencesTypes'

export class FilterState {
    private readonly visible: Record<RefKind, boolean> = {
        [RefKind.Write]: true,
        [RefKind.Read]: true,
        [RefKind.Other]: true,
    };
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this.syncContextKeys();
    }

    private syncContextKeys(): void {
        void vscode.commands.executeCommand(
            "setContext",
            "enhancedReferences.showWrite",
            this.visible[RefKind.Write]
        );
        void vscode.commands.executeCommand(
            "setContext",
            "enhancedReferences.showRead",
            this.visible[RefKind.Read]
        );
        void vscode.commands.executeCommand(
            "setContext",
            "enhancedReferences.showOther",
            this.visible[RefKind.Other]
        );
    }

    toggle(kind: RefKind) {
        this.visible[kind] = !this.visible[kind];
        this.syncContextKeys();
        this._onDidChange.fire();
    }

    isVisible(kind: RefKind): boolean {
        return this.visible[kind];
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}