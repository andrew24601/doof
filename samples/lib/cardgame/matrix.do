export import class Mat4 from "./matrix_bridge.hpp" as doof_boardgame::Mat4 {
  static perspective(fovY: float, aspect: float, nearZ: float, farZ: float): Mat4
  static lookAt(eyeX: float, eyeY: float, eyeZ: float,
                tarX: float, tarY: float, tarZ: float): Mat4
  static ortho(left: float, right: float, bottom: float, top: float,
               nearZ: float, farZ: float): Mat4
  static multiply(a: Mat4, b: Mat4): Mat4
  static inverse(a: Mat4): Mat4
  static frameTransform(scale: float, panX: float, panY: float): Mat4

  projectX(x: float, y: float, z: float): float
  projectY(x: float, y: float, z: float): float
  projectZ(x: float, y: float, z: float): float
}