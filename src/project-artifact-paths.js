export const PROJECT_ARTIFACT_PATHS = {
  manifest: "manifest.json",
  modelMatrix: "model-matrix.json",
  story: "01-input/story.txt",
  adaptation: "02-adaptation/adaptation.json",
  characters: "03-characters/characters.json",
  mediaWorkbench: "06-images/media-workbench.json",
  storyboard: "05-storyboard/storyboard.json",
  subtitles: "08-subtitles/subtitles.srt",
};

export function stageArtifactPath(stage) {
  return {
    adaptation: PROJECT_ARTIFACT_PATHS.adaptation,
    characters: PROJECT_ARTIFACT_PATHS.characters,
    storyboard: PROJECT_ARTIFACT_PATHS.storyboard,
  }[stage] || "";
}
