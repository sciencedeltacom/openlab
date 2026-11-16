/**
 * Literature screen entry points.
 *
 * The registry imports its surfaces from here rather than from the feature folder, the way
 * the other sections do, so a route never has to know which file a view lives in.
 */

export { ReviewView } from '@/components/literature/ReviewView';
export { ReviewsIndex } from '@/components/literature/ReviewsIndex';
export { ReviewCreate } from '@/components/literature/ReviewCreate';
