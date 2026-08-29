declare global {
    interface Window {
        electronAPI: {
            exitApplication: () => Promise<void>;
        };
    }
}

export { };