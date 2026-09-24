function normalizedAvatarName(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim() || 'Joueur';
}

export function avatarInitials(value) {
  const name = normalizedAvatarName(value);
  const words = name.split(' ').filter(Boolean);
  if (words.length >= 2) {
    return `${Array.from(words[0])[0] || ''}${Array.from(words.at(-1))[0] || ''}`.toUpperCase() || '?';
  }

  return Array.from(words[0] || '?').slice(0, 2).join('').toUpperCase() || '?';
}

export function avatarHue(value) {
  const name = normalizedAvatarName(value);
  let hash = 2166136261;
  for (const char of name) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 360;
}

export function applyGeneratedAvatarFallback(element, value) {
  if (!element) return;
  element.textContent = avatarInitials(value);
  element.classList.add('generated-avatar');
  element.style.setProperty('--avatar-hue', String(avatarHue(value)));
}
