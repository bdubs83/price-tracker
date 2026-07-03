import type { AppUser } from '../types';

type CreateMemberSessionResponse = {
  token: string;
  user: AppUser;
};

export async function createMemberSession(email: string) {
  const [{ auth, functions }, { signInWithCustomToken }, { httpsCallable }] = await Promise.all([
    import('../firebase/firebase'),
    import('firebase/auth'),
    import('firebase/functions'),
  ]);

  if (!auth || !functions) {
    throw new Error('Firebase is not configured for this build.');
  }

  const createSession = httpsCallable<{ email: string }, CreateMemberSessionResponse>(functions, 'createMemberSession');
  const result = await createSession({ email });
  await signInWithCustomToken(auth, result.data.token);
  return result.data.user;
}

export async function signOutMember() {
  const [{ auth }, { signOut }] = await Promise.all([
    import('../firebase/firebase'),
    import('firebase/auth'),
  ]);

  if (auth) await signOut(auth);
}
