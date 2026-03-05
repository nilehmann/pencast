import { mount } from "svelte";
import App from "./App.svelte";
import { installConsoleInterceptor } from "./debug-log";

installConsoleInterceptor();
mount(App, { target: document.getElementById("app")! });
