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

    return {
        entry: {
            Spectrogram: './src/karaokeWebIntegration.js',
            SpectrogramRenderer: './src/spectrogramRenderer.js',
        },
        devtool: 'source-map',
        target: 'web',
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
    };
};
