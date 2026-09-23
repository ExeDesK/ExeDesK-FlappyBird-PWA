const SUPPORTED_PROFILE_PROVIDERS = Object.freeze(['discord', 'google']);

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function providerKey(value) {
  return String(value || '').trim().toLowerCase();
}

function metadataProfile(provider, data = {}, createdAt = null) {
  const username = cleanText(
    data.user_name
      || data.preferred_username
      || data.username
      || data.name,
  );
  const displayName = cleanText(
    data.full_name
      || data.global_name
      || data.name
      || data.user_name
      || data.preferred_username
      || data.email,
  );
  const avatarUrl = cleanText(data.avatar_url || data.picture);

  return {
    provider,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    email: cleanText(data.email),
    created_at: createdAt || null,
  };
}

export function providerProfilesFromUser(user) {
  const profiles = [];
  const seen = new Set();
  const currentProvider = providerKey(user?.app_metadata?.provider);
  const currentMetadata = user?.user_metadata || {};

  for (const identity of Array.isArray(user?.identities) ? user.identities : []) {
    const provider = providerKey(identity?.provider);
    if (!provider || seen.has(provider)) continue;

    const identityData = identity?.identity_data && typeof identity.identity_data === 'object'
      ? identity.identity_data
      : {};
    const mergedData = provider === currentProvider
      ? { ...currentMetadata, ...identityData }
      : identityData;

    profiles.push(metadataProfile(provider, mergedData, identity?.created_at || null));
    seen.add(provider);
  }

  const metadataProviders = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [user?.app_metadata?.provider].filter(Boolean);

  for (const rawProvider of metadataProviders) {
    const provider = providerKey(rawProvider);
    if (!provider || seen.has(provider)) continue;

    profiles.push(metadataProfile(provider, currentMetadata, null));
    seen.add(provider);
  }

  return profiles.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bTime = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return SUPPORTED_PROFILE_PROVIDERS.indexOf(a.provider) - SUPPORTED_PROFILE_PROVIDERS.indexOf(b.provider);
  });
}

export function firstConnectedProvider(user) {
  const profiles = providerProfilesFromUser(user);
  const signupProvider = providerKey(user?.app_metadata?.provider);
  if (signupProvider && profiles.some(item => item.provider === signupProvider)) {
    return signupProvider;
  }
  return profiles[0]?.provider || null;
}

export function providerProfile(user, provider) {
  const key = providerKey(provider);
  return providerProfilesFromUser(user).find(item => item.provider === key) || null;
}

export function providerAvatarUrl(user, provider) {
  return providerProfile(user, provider)?.avatar_url || null;
}

export function availableAvatarProviders(user) {
  return providerProfilesFromUser(user)
    .filter(item => SUPPORTED_PROFILE_PROVIDERS.includes(item.provider) && item.avatar_url);
}

export function resolvedAvatarProvider(user, profile = null) {
  const available = availableAvatarProviders(user);
  const selected = providerKey(profile?.avatar_provider);
  if (selected && available.some(item => item.provider === selected)) {
    return selected;
  }

  const firstProvider = firstConnectedProvider(user);
  if (firstProvider && available.some(item => item.provider === firstProvider)) {
    return firstProvider;
  }

  return available[0]?.provider || null;
}

export { SUPPORTED_PROFILE_PROVIDERS };
