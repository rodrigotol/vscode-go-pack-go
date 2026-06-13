import * as vscode from 'vscode';
import { ClassifiedReference, RefKind } from './readWriteReferencesTypes';
import { classifyByHighlights } from './readWriteReferencesClassification';

export async function findClassifiedReferences(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken
): Promise<ClassifiedReference[]> {
    const references: vscode.Location[] = await vscode.commands.executeCommand("vscode.executeReferenceProvider", uri, position);

    if (references.length == 0) {
        return [];
    }

    const byFile = new Map<string, vscode.Location[]>();
    for (const ref of references) {
        const key = ref.uri.toString();
        const list = byFile.get(key);

        if (list) {
            list.push(ref);
        } else {
            byFile.set(key, [ref]);
        }
    }

    const classifiedRefs: ClassifiedReference[] = [];
    for (const [, fileLocations] of byFile) {
        if (token?.isCancellationRequested) {
            break;
        }

        const fileUri = fileLocations[0].uri;
        const doc = await openDocumentSafe(fileUri);
        const highlights = await highlightsAt(fileUri, fileLocations[0].range.start);

        for (const loc of fileLocations) {
            let kind = classifyByHighlights(loc.range, highlights);

            if (kind === RefKind.Other) {
                 const own = await highlightsAt(fileUri, loc.range.start);
                 kind = classifyByHighlights(loc.range, own);
            }

            classifiedRefs.push({
                uri: fileUri,
                range: loc.range,
                kind: kind,
                lineText: lineTextAt(doc, loc.range),
            });
        }
    }

    return classifiedRefs;
}

async function highlightsAt(
    fileUri: vscode.Uri,
    position: vscode.Position
): Promise<vscode.DocumentHighlight[]> {
    try{
        return (
            (await vscode.commands.executeCommand<vscode.DocumentHighlight[] | undefined>(
                "vscode.executeDocumentHighlights",
                fileUri,
                position
            )) ?? []
        );
    } catch(err) {
        return [];
    }
}

function lineTextAt(
    doc: vscode.TextDocument | undefined,
    range: vscode.Range
): string {
    if (!doc) {
        return "";
    }

    try {
        return doc.lineAt(range.start.line).text.trim();
    } catch {
        return "";
    }
}

async function openDocumentSafe(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    try {
        return await vscode.workspace.openTextDocument(uri);
    } catch {
        return undefined;
    }
}