declare global {
    interface Window {
        preload: {
            exitApplication: () => Promise<void>;
        };
    }
}

export { };