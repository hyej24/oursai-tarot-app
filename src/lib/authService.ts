import { 
  auth, 
  googleProvider 
} from './firebase';
import { 
  signInWithPopup, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';

const STATIC_SIMULATION_PASSWORD = "VirtualSimulationTarot123!";

export const authService = {
  // 1. Google sign-in
  loginWithGoogle: async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (error) {
      console.error("Google login failed:", error);
      throw error;
    }
  },

  // 2. Simulation/virtual login with email (frictionless signup/login with real Firebase Auth)
  loginWithSimulationEmail: async (email: string) => {
    try {
      // Try to sign in first
      const result = await signInWithEmailAndPassword(auth, email, STATIC_SIMULATION_PASSWORD);
      return result.user;
    } catch (error: any) {
      // If user does not exist, automatically sign up!
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        try {
          const result = await createUserWithEmailAndPassword(auth, email, STATIC_SIMULATION_PASSWORD);
          return result.user;
        } catch (signupError) {
          console.error("Simulation auto-signup failed:", signupError);
          throw signupError;
        }
      }
      console.error("Simulation sign-in failed:", error);
      throw error;
    }
  },

  // 3. Sign out
  logout: async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
      throw error;
    }
  }
};
