import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: process.env.AID_LOCAL_COMPANION === '1',
    name: 'AID Companion',
    version: process.env.AID_COMPANION_VERSION || 'development',
    nativeVideoExport: true,
    h3DirectorLongVideo: true,
    storyOriginalAssetGrounding: true,
    seriesProduction: true,
    seriesLibraryCasting: true,
    seriesIndependentPreparation: true,
    seriesStyleReference: true,
    seriesTrash: true,
    seriesJobDeletion: true,
    seriesFishVoiceCatalog: true,
    seriesCharacterAppearance: true,
    seriesFixedObjects: true,
    seriesObjectAutoReferences: true,
    seriesCharacterCardJobs: true,
    seriesIndividualAssetJobs: true,
    seriesAssetScriptReconciliation: true,
    seriesNarrativeObjectInsertion: true,
    seriesVisualRedo: true,
    seriesVisualPromptRewrite: true,
    seriesFlexibleDeliveryDuration: true,
    seriesRecovery: true,
    seriesCrossLanguageVoices: true,
    sshDirectHost: process.env.COMFYUI_SSH_DIRECT_HOST || '',
    sshTransport: process.env.AID_COMPANION_SYSTEM_SSH === '1' ? 'system' : 'embedded',
  });
}
