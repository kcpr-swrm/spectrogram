import TerserPlugin from "terser-webpack-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function pascalToKebab(s) {
    return s
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')   // aB -> a-B
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // ABc -> A-Bc
        .toLowerCase();
}

export default (env, argv) => {

    let config = {
        entry: {
        },
        target: 'web',
        output: {
        },
        optimization: {
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        compress: {
                            defaults: false,
                            unused: true,
                        },
                        output: {
                            beautify: true,
                        },
                        mangle: false,
                    }
                })
            ]
        },
        resolve: {
            extensions: ['.js'],
        },
    };

    const worklets = Object.assign({}, config, {
        name: 'worklets',
        entry: {
            'notifyAnalyserProcessor.worklet.js': './src/worklets/notifyAnalyserProcessor.worklet.js',
            'notifyProcessor.worklet.js': './src/worklets/notifyProcessor.worklet.js',
        },
        output: {
            path: path.resolve(__dirname, 'build/worklets'),
            filename: (pathData) => {
                const name = pathData.chunk.name;
                return `${name}`;
            },
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    loader: 'babel-loader',
                },
            ],
        },
    });

    const spectrogram = Object.assign({}, config, {
        name: 'spectrogram',
        dependencies: ['worklets'],
        entry: {
            SpectrogramRenderer: './src/spectrogramRenderer.js',
            Spectrogram: './src/karaokeWebIntegration.js',
        },
        devtool: 'source-map',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: (pathData) => {
                const name = pascalToKebab(pathData.chunk.name);
                return argv.mode === 'production' ?
                    `${name}.js` :
                    `${name}.dev.js`;
            },
            library: {
                name: "[name]",
                type: "var",
                export: "default",
            },
        },
        devServer: {
            static: {
                directory: path.join(__dirname, "dist"),
            },
        },
        module: {
            rules: [
                {
                    test: /\.glsl$/,
                    exclude: /node_modules/,
                    use: [{
                        loader: 'webpack-glsl-minify',
                        options: {
                            preserveAll: true,
                            disableMangle: true,
                        }
                    }],
                },
                {
                    test: /\.worklet\.js$/,
                    exclude: /node_modules/,
                    type: 'asset/source',
                },
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    loader: 'babel-loader',
                },
            ],
        },
    });

    return [worklets, spectrogram];
};
