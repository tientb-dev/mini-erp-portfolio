import { createContext } from 'react';

/** Opens another page on one document (`page` is an App page key); the target page checks permissions again. */
export const NavContext = createContext<(page: string, id: number) => void>(() => undefined);
