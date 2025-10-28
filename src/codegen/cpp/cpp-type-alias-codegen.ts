// C++ type alias declaration generation for doof

import { TypeAliasDeclaration } from '../../types';
import { CppGenerator } from '../cppgen';

export function generateTypeAliasDeclaration(generator: CppGenerator, aliasDecl: TypeAliasDeclaration): string {
  const aliasName = aliasDecl.name.name;
  const targetType = generator.generateType(aliasDecl.type);

  return `using ${aliasName} = ${targetType};\n\n`;
}
