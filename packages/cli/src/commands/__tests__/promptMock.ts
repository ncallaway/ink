import { mock } from "bun:test";

export const mockPrompts = {
    select: mock(() => Promise.resolve()),
    input: mock(() => Promise.resolve("")),
    checkbox: mock(() => Promise.resolve([])),
    confirm: mock(() => Promise.resolve(true))
};

mock.module("@inquirer/prompts", () => mockPrompts);
