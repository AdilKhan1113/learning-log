import * as Crypto from 'expo-crypto';

/**
 * Client-generated row id.
 *
 * Ids are made on the device so a row can be created offline and pushed later
 * without renumbering. expo-crypto is used rather than Math.random because
 * these are primary keys that have to stay unique across every device a user
 * signs in on.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
