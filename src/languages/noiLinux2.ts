import { Language } from './index';

// Keep legacy language contracts for external rootfs users; Docker selects this profile explicitly.
const supported = ['cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp-noilinux', 'cpp11-noilinux', 'c', 'c-noilinux', 'pascal', 'python2', 'python3'];

export function configureNoiLinux2(language: Language): Language {
    if (supported.indexOf(language.name) === -1) return null;
    if (language.name.indexOf('cpp') !== 0 && language.name !== 'c' && language.name !== 'c-noilinux') return language;
    const cpp = language.name.indexOf('cpp') === 0;
    const compiler = cpp ? 'g++-9' : 'gcc-9';
    return Object.assign({}, language, {
        compile: (sourcePath: string, outputDirectory: string) => {
            const result = language.compile(sourcePath, outputDirectory, true);
            result.executable = '/usr/bin/' + compiler;
            result.parameters = [compiler].concat(result.parameters.slice(1).filter(flag => flag !== '-mx32'));
            if (cpp && !result.parameters.some(flag => flag.indexOf('-std=') === 0)) result.parameters.push('-std=c++14');
            if (result.parameters.indexOf('-static') === -1) result.parameters.push('-static');
            return result;
        }
    });
}
