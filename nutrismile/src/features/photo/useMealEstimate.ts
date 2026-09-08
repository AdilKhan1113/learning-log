/**
 * Taking a meal photo and turning it into a reviewable estimate.
 *
 * Nothing this produces is logged automatically. The estimate is a proposal
 * the user edits and confirms; `confirm` is the only thing that writes, and
 * only the user can call it.
 */
import { useCallback, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  type EstimateFailure,
  type EstimatedFood,
  type MealEstimate,
  describeEstimateFailure,
  estimateMeal,
  rescaleFood,
} from '../../services/vision/index.ts';
import type { Meal } from '../../domain/types.ts';
import { logEntries } from '../../db/repositories/index.ts';
import { today } from '../../utils/dates.ts';

export type EstimateStage =
  | { status: 'idle' }
  | { status: 'estimating' }
  | { status: 'reviewing'; estimate: MealEstimate; photoUri: string | null }
  | { status: 'failed'; message: string; failure: EstimateFailure };

export interface MealEstimateState {
  stage: EstimateStage;
  saving: boolean;
  /** Take a photo and estimate it. */
  captureAndEstimate: (source: 'camera' | 'library') => Promise<void>;
  /** Correct a portion; the nutrition follows. */
  setPortion: (foodId: string, grams: number) => void;
  /** Drop a line the model got wrong. */
  removeFood: (foodId: string) => void;
  /** Write the reviewed lines to the log. The only thing here that writes. */
  confirm: (userId: string, meal: Meal) => Promise<number>;
  reset: () => void;
}

/** Quality is traded for upload size: a 45s round trip is worse than a
 *  slightly softer image, and the model does not need a full-resolution shot. */
const IMAGE_QUALITY = 0.6;
const MAX_DIMENSION = 1280;

export function useMealEstimate(): MealEstimateState {
  const [stage, setStage] = useState<EstimateStage>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const captureAndEstimate = useCallback(async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setStage({
        status: 'failed',
        failure: { code: 'unavailable' },
        message:
          source === 'camera'
            ? 'NutriSmile needs the camera to photograph a meal. You can turn it on in Settings, or search for the food instead.'
            : 'NutriSmile needs access to your photos for this. You can turn it on in Settings, or search for the food instead.',
      });
      return;
    }

    const picker =
      source === 'camera'
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;

    const result = await picker({
      mediaTypes: ['images'],
      quality: IMAGE_QUALITY,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.base64) {
      setStage({
        status: 'failed',
        failure: { code: 'unreadable' },
        message: 'That photo could not be read. Nothing was logged.',
      });
      return;
    }

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setStage({ status: 'estimating' });

    try {
      const estimate = await estimateMeal(asset.base64, {
        mediaType: 'image/jpeg',
        signal: controller.signal,
      });

      if (!estimate.ok) {
        setStage({
          status: 'failed',
          failure: estimate.error,
          message: describeEstimateFailure(estimate.error),
        });
        return;
      }

      setStage({ status: 'reviewing', estimate: estimate.value, photoUri: asset.uri ?? null });
    } catch {
      // Aborted because the screen went away or a newer capture started.
      setStage({ status: 'idle' });
    }
  }, []);

  const updateFoods = useCallback(
    (transform: (foods: EstimatedFood[]) => EstimatedFood[]) => {
      setStage((current) =>
        current.status === 'reviewing'
          ? {
              ...current,
              estimate: { ...current.estimate, foods: transform(current.estimate.foods) },
            }
          : current,
      );
    },
    [],
  );

  const setPortion = useCallback(
    (foodId: string, grams: number) => {
      updateFoods((foods) =>
        foods.map((food) => (food.id === foodId ? rescaleFood(food, grams) : food)),
      );
    },
    [updateFoods],
  );

  const removeFood = useCallback(
    (foodId: string) => {
      updateFoods((foods) => foods.filter((food) => food.id !== foodId));
    },
    [updateFoods],
  );

  const confirm = useCallback(
    async (userId: string, meal: Meal): Promise<number> => {
      if (stage.status !== 'reviewing') return 0;
      setSaving(true);

      try {
        const photoUri = stage.photoUri;
        for (const food of stage.estimate.foods) {
          await logEntries.create({
            userId,
            logDate: today(),
            meal,
            name: food.name,
            quantity: food.grams,
            unitLabel: 'g',
            amountInBasis: food.grams,
            basisUnit: 'g',
            nutrition: {
              kcal: food.kcal,
              proteinG: food.proteinG,
              carbsG: food.carbsG,
              fatG: food.fatG,
            },
            entrySource: 'photo_ai',
            // Marks the row as an estimate for the life of the entry, which is
            // what puts the label on it in the log.
            isEstimate: true,
            aiConfidence: food.confidence,
            notes: photoUri ? `Estimated from a photo` : null,
          });
        }
        const count = stage.estimate.foods.length;
        setStage({ status: 'idle' });
        return count;
      } finally {
        setSaving(false);
      }
    },
    [stage],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setStage({ status: 'idle' });
  }, []);

  return { stage, saving, captureAndEstimate, setPortion, removeFood, confirm, reset };
}
