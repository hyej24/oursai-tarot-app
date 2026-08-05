import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, orderBy, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { SavedReading } from './readingStorage';
import { PartnerProfile } from '../types';

export interface UserCloudStats {
  uid: string;
  attendanceCount: number;
  isRewardClaimed: boolean;
  rewardCode: string;
  createdAt: string;
}

export const dataSync = {
  // Save a tarot reading to cloud
  saveReadingCloud: async (uid: string, reading: SavedReading): Promise<void> => {
    const path = `users/${uid}/readings/${reading.id}`;
    try {
      await setDoc(doc(db, 'users', uid, 'readings', reading.id), {
        ...reading,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  },

  // Get all tarot readings from cloud
  getReadingsCloud: async (uid: string): Promise<SavedReading[]> => {
    const path = `users/${uid}/readings`;
    try {
      const q = query(collection(db, 'users', uid, 'readings'));
      const querySnapshot = await getDocs(q);
      const readings: SavedReading[] = [];
      querySnapshot.forEach((doc) => {
        readings.push(doc.data() as SavedReading);
      });
      // Sort desc by dateTime
      return readings.sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, path);
    }
  },

  // Delete a tarot reading from cloud
  deleteReadingCloud: async (uid: string, readingId: string): Promise<void> => {
    const path = `users/${uid}/readings/${readingId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'readings', readingId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  },

  // Save partner profile to cloud
  savePartnerCloud: async (uid: string, partner: PartnerProfile): Promise<void> => {
    const path = `users/${uid}/partners/${partner.id}`;
    try {
      await setDoc(doc(db, 'users', uid, 'partners', partner.id), {
        ...partner,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  },

  // Get all partner profiles from cloud
  getPartnersCloud: async (uid: string): Promise<PartnerProfile[]> => {
    const path = `users/${uid}/partners`;
    try {
      const q = query(collection(db, 'users', uid, 'partners'));
      const querySnapshot = await getDocs(q);
      const partners: PartnerProfile[] = [];
      querySnapshot.forEach((doc) => {
        partners.push(doc.data() as PartnerProfile);
      });
      return partners;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, path);
    }
  },

  // Delete a partner profile from cloud
  deletePartnerCloud: async (uid: string, partnerId: string): Promise<void> => {
    const path = `users/${uid}/partners/${partnerId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'partners', partnerId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  },

  // Save User Stats (attendance, rewards) to cloud
  saveUserStatsCloud: async (uid: string, stats: Partial<UserCloudStats>): Promise<void> => {
    const path = `users/${uid}`;
    try {
      const docRef = doc(db, 'users', uid);
      const existing = await getDoc(docRef);
      if (existing.exists()) {
        await setDoc(docRef, { ...existing.data(), ...stats }, { merge: true });
      } else {
        await setDoc(docRef, {
          uid,
          attendanceCount: stats.attendanceCount ?? 0,
          isRewardClaimed: stats.isRewardClaimed ?? false,
          rewardCode: stats.rewardCode ?? '',
          createdAt: new Date().toISOString()
        });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  },

  // Get User Stats from cloud
  getUserStatsCloud: async (uid: string): Promise<UserCloudStats | null> => {
    const path = `users/${uid}`;
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as UserCloudStats;
      }
      return null;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, path);
    }
  },

  // MERGE local storage and device data to Cloud (upon successful first-time login)
  mergeLocalToCloud: async (uid: string): Promise<void> => {
    const mergedKey = `tarot_merged_to_cloud_${uid}`;
    if (localStorage.getItem(mergedKey) === 'true') return; // Already merged

    console.log("[DataSync] Starting merge of guest data to Cloud for user:", uid);

    try {
      // 1. Merge User attendance Stats
      const localAttendance = parseInt(localStorage.getItem('tarot_attendance_count') || '0', 10);
      const localRewardClaimed = localStorage.getItem('tarot_reward_claimed') === 'true';
      const localRewardCode = localStorage.getItem('tarot_reward_code') || '';

      const cloudStats = await dataSync.getUserStatsCloud(uid);
      
      const targetAttendance = Math.max(localAttendance, cloudStats?.attendanceCount ?? 0);
      const targetRewardClaimed = localRewardClaimed || (cloudStats?.isRewardClaimed ?? false);
      const targetRewardCode = localRewardCode || cloudStats?.rewardCode || '';

      await dataSync.saveUserStatsCloud(uid, {
        attendanceCount: targetAttendance,
        isRewardClaimed: targetRewardClaimed,
        rewardCode: targetRewardCode
      });

      // 2. Merge Partner Profiles
      const localPartnersStr = localStorage.getItem('tarot_partner_profiles');
      if (localPartnersStr) {
        try {
          const partners: PartnerProfile[] = JSON.parse(localPartnersStr);
          if (Array.isArray(partners)) {
            for (const partner of partners) {
              await dataSync.savePartnerCloud(uid, partner);
            }
          }
        } catch (err) {
          console.error("Failed to parse local partner profiles during merge:", err);
        }
      }

      // 3. Merge Tarot Readings
      const localReadingsStr = localStorage.getItem('tarot_user_readings');
      if (localReadingsStr) {
        try {
          const readings = JSON.parse(localReadingsStr);
          if (Array.isArray(readings)) {
            for (const reading of readings) {
              await dataSync.saveReadingCloud(uid, reading);
            }
          }
        } catch (err) {
          console.error("Failed to parse local readings during merge:", err);
        }
      }

      // Mark merge complete
      localStorage.setItem(mergedKey, 'true');
      console.log("[DataSync] Merge completed successfully!");
    } catch (error) {
      console.error("Failed to merge client-side guest profiles to cloud:", error);
    }
  }
};
