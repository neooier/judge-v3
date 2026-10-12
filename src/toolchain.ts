export const languageProfile = process.env.SYZOJ_JUDGE_LANGUAGE_PROFILE || 'legacy';
if (languageProfile !== 'legacy' && languageProfile !== 'noi-linux2') {
    throw new Error('Unknown language profile: ' + languageProfile);
}

// Bump the NOI identity when its compiler versions or compile presets change.
export const binaryToolchainId = languageProfile === 'noi-linux2' ? 'noi-linux2-v1' : 'legacy';
